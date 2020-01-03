/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

var fs = require('fs-extra');
var nodeFn = require('when/node/function');
var keys = require('when/keys');
var fspath = require("path");
var yaml = require('js-yaml');
var mkdirp = fs.mkdirs;
const util = require('util');

// var log = require("../node-red/red/runtime/log");

var promiseDir = util.promisify(mkdirp);

var initialFlowLoadComplete = false;
var settings;
var flowsFile;
var flowsFullPath;
var flowsFileBackup;
var credentialsFile;
var credentialsFileBackup;
var oldCredentialsFile;
var sessionsFile;
var libDir;
var libFlowsDir;
var globalSettingsFile;

function getFileMeta(root,path) {
    var fn = fspath.join(root,path);
    var fd = fs.openSync(fn,"r");
    var size = fs.fstatSync(fd).size;
    var meta = {};
    var read = 0;
    var length = 10;
    var remaining = Buffer(0);
    var buffer = Buffer(length);
    var idx = -1;
    while(read < size) {
        read+=fs.readSync(fd,buffer,0,length);
        var data = Buffer.concat([remaining,buffer]);
        while((idx = data.indexOf("\n")) != -1){
            var part = data.slice(0,idx+1);
            var match = /^\/\/ (\w+): (.*)/.exec(part.toString());
            if (match) {
                meta[match[1]] = match[2];
            } else {
                read = size;
                break;
            }
            data = data.slice(idx+1);
        }
        remaining = data;
    }
    fs.closeSync(fd);
    return meta;
}

function getFileBody(root,path) {
    var body = Buffer(0);
    var fn = fspath.join(root,path);
    var fd = fs.openSync(fn,"r");
    var size = fs.fstatSync(fd).size;
    var scanning = true;
    var read = 0;
    var length = 50;
    var remaining = Buffer(0);
    var buffer = Buffer(length);
    var idx = -1;
    while(read < size) {
        var thisRead = fs.readSync(fd,buffer,0,length);
        read += thisRead;
        if (scanning) {
            var data = Buffer.concat([remaining,buffer.slice(0,thisRead)]);
            while((idx = data.indexOf("\n")) != -1){
                var part = data.slice(0,idx+1);
                if (! /^\/\/ \w+: /.test(part.toString())) {
                    scanning = false;
                    body = Buffer.concat([body,data]);
                    break;
                }
                data = data.slice(idx+1);
            }
            remaining = data;
            if (scanning && read >= size) {
                body = Buffer.concat([body,remaining]);
            }
        } else {
            body = Buffer.concat([body,buffer.slice(0,thisRead)]);
        }
    }
    fs.closeSync(fd);
    return body.toString();
}

/**
 * Write content to a file using UTF8 encoding.
 * This forces a fsync before completing to ensure
 * the write hits disk.
 */
function writeFile(path,content) {
    return new Promise(function(resolve,reject) {
        var stream = fs.createWriteStream(path);
        stream.on('open',function(fd) {
            stream.end(content,'utf8',function() {
                fs.fsync(fd,resolve);
            });
        });
        stream.on('error',function(err) {
            reject(err);
        });
    });
}

function parseJSON(data) {
    if (data.charCodeAt(0) === 0xFEFF) {
        data = data.slice(1);
    }
    return JSON.parse(data);
}

function parseYAML(data) {
    return yaml.load(data);
}

function readFile(path,backupPath,emptyResponse,type) {
    return new Promise(function(resolve) {
        fs.readFile(path,'utf8',function(err,data) {
            if (!err) {
                if (data.length === 0) {
                    log.warn(log._("storage.localfilesystem.empty",{type:type}));
                    try {
                        var backupStat = fs.statSync(backupPath);
                        if (backupStat.size === 0) {
                            // Empty flows, empty backup - return empty flow
                            return resolve(emptyResponse);
                        }
                        // Empty flows, restore backup
                        log.warn(log._("storage.localfilesystem.restore",{path:backupPath,type:type}));
                        fs.copy(backupPath,path,function(backupCopyErr) {
                            if (backupCopyErr) {
                                // Restore backup failed
                                log.warn(log._("storage.localfilesystem.restore-fail",{message:backupCopyErr.toString(),type:type}));
                                resolve([]);
                            } else {
                                // Loop back in to load the restored backup
                                resolve(readFile(path,backupPath,emptyResponse,type));
                            }
                        });
                        return;
                    } catch(backupStatErr) {
                        // Empty flow file, no back-up file
                        return resolve(emptyResponse);
                    }
                }
                try {
                    return resolve(parseYAML(data));
                } catch(parseErr) {
                    log.warn(log._("storage.localfilesystem.invalid",{type:type}));
                    return resolve(emptyResponse);
                }
            } else {
                if (type === 'flow') {
                    log.info(log._("storage.localfilesystem.create",{type:type}));
                }
                resolve(emptyResponse);
            }
        });
    });
}

var localfilesystem_yaml = {
    init: function(_settings) {
        settings = _settings;

        var promises = [];

        if (!settings.userDir) {
            try {
                fs.statSync(fspath.join(process.env.NODE_RED_HOME,".config.json"));
                settings.userDir = process.env.NODE_RED_HOME;
            } catch(err) {
                try {
                    // Consider compatibility for older versions
                    if (process.env.HOMEPATH) {
                        fs.statSync(fspath.join(process.env.HOMEPATH,".node-red",".config.json"));
                        settings.userDir = fspath.join(process.env.HOMEPATH,".node-red");
                    }
                } catch(err) {
                }
                if (!settings.userDir) {
                    settings.userDir = fspath.join(process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || process.env.NODE_RED_HOME,".node-red");
                    if (!settings.readOnly) {
                        promises.push(promiseDir(fspath.join(settings.userDir,"node_modules")));
                    }
                }
            }
        }

        if (settings.flowFile) {
            flowsFile = settings.flowFile;
            // handle Unix and Windows "C:\"
            if ((flowsFile[0] == "/") || (flowsFile[1] == ":")) {
                // Absolute path
                flowsFullPath = flowsFile;
            } else if (flowsFile.substring(0,2) === "./") {
                // Relative to cwd
                flowsFullPath = fspath.join(process.cwd(),flowsFile);
            } else {
                try {
                    fs.statSync(fspath.join(process.cwd(),flowsFile));
                    // Found in cwd
                    flowsFullPath = fspath.join(process.cwd(),flowsFile);
                } catch(err) {
                    // Use userDir
                    flowsFullPath = fspath.join(settings.userDir,flowsFile);
                }
            }

        } else {
            flowsFile = 'flows_'+require('os').hostname()+'.yaml';
            flowsFullPath = fspath.join(settings.userDir,flowsFile);
        }
        var ffExt = fspath.extname(flowsFullPath);
        var ffName = fspath.basename(flowsFullPath);
        var ffBase = fspath.basename(flowsFullPath,ffExt);
        var ffDir = fspath.dirname(flowsFullPath);

        credentialsFile = fspath.join(settings.userDir,ffBase+"_cred"+ffExt);
        credentialsFileBackup = fspath.join(settings.userDir,"."+ffBase+"_cred"+ffExt+".backup");

        oldCredentialsFile = fspath.join(settings.userDir,"credentials.json");

        flowsFileBackup = fspath.join(ffDir,"."+ffName+".backup");

        sessionsFile = fspath.join(settings.userDir,".sessions.json");

        libDir = fspath.join(settings.userDir,"lib");
        libFlowsDir = fspath.join(libDir,"flows");

        globalSettingsFile = fspath.join(settings.userDir,".config.json");

        var packageFile = fspath.join(settings.userDir,"package.json");
        var packagePromise = Promise.resolve();
        if (!settings.readOnly) {
            promises.push(promiseDir(libFlowsDir));
            packagePromise = function() {
                try {
                    fs.statSync(packageFile);
                } catch(err) {
                    var defaultPackage = {
                        "name": "node-red-project",
                        "description": "A Node-RED Project",
                        "version": "0.0.1"
                    };
                    return writeFile(packageFile,JSON.stringify(defaultPackage,"",4));
                }
                return true;
            };
        }
        return Promise.all(promises).then(packagePromise);
    },

    getFlows: function() {
        if (!initialFlowLoadComplete) {
            initialFlowLoadComplete = true;
        }
        return readFile(flowsFullPath,flowsFileBackup,[],'flow');
    },

    saveFlows: function(flows) {
        if (settings.readOnly) {
            return Promise.resolve();
        }

        try {
            fs.renameSync(flowsFullPath,flowsFileBackup);
        } catch(err) {
        }

        var flowData;

        if (settings.flowFilePretty) {
            flowData = yaml.dump(flows, {'lineWidth': 160});
        } else {
            flowData = yaml.dump(flows, {'lineWidth': 160});
        }
        return writeFile(flowsFullPath, flowData);
    },

    getCredentials: function() {
        return readFile(credentialsFile,credentialsFileBackup,{},'credentials');
    },

    saveCredentials: function(credentials) {
        if (settings.readOnly) {
            return Promise.resolve();
        }

        try {
            fs.renameSync(credentialsFile,credentialsFileBackup);
        } catch(err) {
        }
        var credentialData;
        if (settings.flowFilePretty) {
            credentialData = JSON.stringify(credentials,null,4);
        } else {
            credentialData = JSON.stringify(credentials);
        }
        return writeFile(credentialsFile, credentialData);
    },

    getSettings: function() {
        return new Promise(function(resolve,reject) {
            fs.readFile(globalSettingsFile,'utf8',function(err,data) {
                if (!err) {
                    try {
                        return resolve(parseJSON(data));
                    } catch(err2) {
                        console.trace("Corrupted config detected - resetting");
                    }
                }
                return resolve({});
            });
        });
    },
    saveSettings: function(newSettings) {
        if (settings.readOnly) {
            return Promise.resolve();
        }
        return writeFile(globalSettingsFile,JSON.stringify(newSettings,null,1));
    },
    getSessions: function() {
        return new Promise(function(resolve,reject) {
            fs.readFile(sessionsFile,'utf8',function(err,data){
                if (!err) {
                    try {
                        return resolve(parseJSON(data));
                    } catch(err2) {
                        console.trace("Corrupted sessions file - resetting");
                    }
                }
                resolve({});
            });
        });
    },
    saveSessions: function(sessions) {
        if (settings.readOnly) {
            return Promise.resolve();
        }
        return writeFile(sessionsFile,JSON.stringify(sessions));
    },

    getLibraryEntry: function(type,path) {
        var root = fspath.join(libDir,type);
        var rootPath = fspath.join(libDir,type,path);

        // don't create the folder if it does not exist - we are only reading....

        return util.promisify(fs.lstat).call(rootPath).then(function(stats) {
            if (stats.isFile()) {
                return getFileBody(root,path);
            }
            if (path.substr(-1) == '/') {
                path = path.substr(0,path.length-1);
            }
            return util.promisify(fs.readdir).call(rootPath).then(function(fns) {
                var dirs = [];
                var files = [];
                fns.sort().filter(function(fn) {
                    var fullPath = fspath.join(path,fn);
                    var absoluteFullPath = fspath.join(root,fullPath);
                    if (fn[0] != ".") {
                        var stats = fs.lstatSync(absoluteFullPath);
                        if (stats.isDirectory()) {
                            dirs.push(fn);
                        } else {
                            var meta = getFileMeta(root,fullPath);
                            meta.fn = fn;
                            files.push(meta);
                        }
                    }
                });
                return dirs.concat(files);
            });
        }).otherwise(function(err) {
            // if path is empty, then assume it was a folder, return empty
            if (path === ""){
                return [];
            }

            // if path ends with slash, it was a folder
            // so return empty
            if (path.substr(-1) == '/') {
                return [];
            }

            // else path was specified, but did not exist,
            // check for path.json as an alternative if flows
            if (type === "flows" && !/\.json$/.test(path)) {
                return localfilesystem_yaml.getLibraryEntry(type,path+".json")
                .otherwise(function(e) {
                    throw err;
                });
            } else {
                throw err;
            }
        });
    },

    saveLibraryEntry: function(type,path,meta,body) {
        if (settings.readOnly) {
            return Promise.resolve();
        }
        if (type === "flows" && !path.endsWith(".json")) {
            path += ".json";
        }
        var fn = fspath.join(libDir, type, path);
        var headers = "";
        for (var i in meta) {
            if (meta.hasOwnProperty(i)) {
                headers += "// "+i+": "+meta[i]+"\n";
            }
        }
        if (type === "flows" && settings.flowFilePretty) {
            body = JSON.stringify(JSON.parse(body),null,4);
        }
        return promiseDir(fspath.dirname(fn)).then(function () {
            writeFile(fn,headers+body);
        });
    }
};

module.exports = localfilesystem_yaml;
