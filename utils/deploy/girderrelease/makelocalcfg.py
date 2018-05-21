#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os

rootPath = os.environ['KWDEMO_KEY']

cfg = """
[global]
server.socket_port: 8080
tools.proxy.on: True
tools.proxy.base: "http://demo.kitware.com/girder1-py2"
tools.proxy.local: ""

[database]
uri: "mongodb://%HOSTIP%:27017/%ROOTPATHSTRIP%"

[server]
# Set to "production" or "development"
mode: "production"
"""

hostip = os.popen(
    "netstat -nr | grep '^0\.0\.0\.0' | awk '{print $2}'").read().strip()
cfg = cfg.replace('%HOSTIP%', hostip)
cfg = cfg.replace('%ROOTPATH%', rootPath)
cfg = cfg.replace('%ROOTPATHSTRIP%', rootPath.replace('.', '').split('-')[0])
print(cfg.strip())
