# node-red-contrib-yaml-storage
A Node-RED storage plugin that store flows as YAML for readability.

## The problem

Node-RED stores flow files as JSON documents.  While JSON is lightweight and universal, it is not the most human readable format.  Node-RED stores various forms of code in function, comment and template nodes such as JavaScript, HTML, CSS, Markdown, etc.  These code blocks are reprensented as a single line in a JSON structure which makes it hard to debug when reading the flow file and it makes diffs very difficult to read.

## A solution

This plugin reads and saves flow files as YAML documents instead.  The main advantage of YAML for this situation is it's ability to represent strings on multiple lines meaning code blocks are represented in a more readable form.  The following example shows the same flow in both JSON and YAML.  The flow contains a function node, a template with some CSS and a comment with some Markdown.

### JSON
```json
[
    {
        "id": "65811770.aa589",
        "type": "function",
        "z": "6ae508c2.fc343",
        "name": "A function",
        "func": "const hostname = global.get('hostname');\nconst common = global.get('common');\nmsg.batch = common.decBatchToLetterMap[msg.batch];\n\nvar cgroups = [1,2,3,4,5,6,7,8,9];\nif (msg.payload == 70) {\n    for (let g of cgroups) {\n        node.send({payload: {zone: 18, group: g, batch: msg.batch, in: true, hostname: hostname}});\n    }\n}",
        "outputs": 1,
        "noerr": 0,
        "x": 270,
        "y": 160,
        "wires": [
            []
        ]
    },
    {
        "id": "965aeb35.0f2578",
        "type": "comment",
        "z": "6ae508c2.fc343",
        "name": "A Markdown comment",
        "info": "# This is some Markdown !\n\nThis is text formatted as Markdown !\n\n## This is a sub-section\n\n- And the first item of a list\n- And the second !",
        "x": 300,
        "y": 100,
        "wires": []
    },
    {
        "id": "95102b6b.7500c8",
        "type": "template",
        "z": "6ae508c2.fc343",
        "name": "Some CSS",
        "field": "payload",
        "fieldType": "msg",
        "format": "css",
        "syntax": "mustache",
        "template": ".color1 {color: blue};\n.color2 {color: red};\n.color3 {color: purple};",
        "output": "str",
        "x": 270,
        "y": 240,
        "wires": [
            []
        ]
    }
]
```

### YAML
```yaml
- id: 6ae508c2.fc343
  type: tab
  label: Flow 1
- id: 65811770.aa589
  type: function
  z: 6ae508c2.fc343
  name: A function
  func: |-
    const hostname = global.get('hostname');
    const common = global.get('common');
    msg.batch = common.decBatchToLetterMap[msg.batch];

    var cgroups = [1,2,3,4,5,6,7,8,9];
    if (msg.payload == 70) {
        for (let g of cgroups) {
            node.send({payload: {zone: 18, group: g, batch: msg.batch, in: true, hostname: hostname}});
        }
    }
  outputs: 1
  noerr: 0
  x: 270
  'y': 160
  wires:
    - []
- id: 965aeb35.0f2578
  type: comment
  z: 6ae508c2.fc343
  name: A Markdown comment
  info: |-
    # This is some Markdown !

    This is text formatted as Markdown !

    ## This is a sub-section

    - And the first item of a list
    - And the second !
  x: 300
  'y': 100
  wires: []
- id: 95102b6b.7500c8
  type: template
  z: 6ae508c2.fc343
  name: Some CSS
  field: payload
  fieldType: msg
  format: css
  syntax: mustache
  template: |-
    .color1 {color: blue};
    .color2 {color: red};
    .color3 {color: purple};
  output: str
  x: 270
  'y': 240
  wires:
    - []
```

As you can see the structure of the code is preserved in the YAML version, making it easier to read.

## Installation

If installed locally:
```
npm install node-red-contrib-yaml-storage
```

If installed globally:
```
sudo npm install -g node-red-contrib-yaml-storage
```

You will also need to modify your `settings.js` file and add the following:

```javascript
storageModule: 'node-red-contrib-yaml-storage'
```

To convert an existing flow to yaml, with the plugin installed and the storageModule configured, just rename your flow file with a `.yaml` extension instead of a `.json` extension.  After first deploy, the flow will be converted to YAML.
