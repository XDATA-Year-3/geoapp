#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os

rootPath = os.environ['KWDEMO_KEY']

cfg = """
[global]
server.socket_port: 8080
tools.proxy.on: True
tools.proxy.base: "/%ROOTPATH%"
tools.proxy.local: ""

[database]
uri: "mongodb://%HOSTIP%:27017/%ROOTPATH%"

[server]
# Set to "production" or "development"
mode: "production"
api_root: "../api/v1"
static_root: "girder/static"

[resources]
# The activityLog is where the Draper logging receiver is located.  If this
# optional module is not included, this parameter is irrelevant
activityLogURI:

# Each entry in this section is an available database.  The order is by lowest
# "order" value, then alphabetically for ties.  Each entry consists of {"name":
# (name shown to the user), "class": (internal database class, such as
# TaxiViaPostgres), "params": (database specific parameters)}
[taxidata]
#postgresfullg:
postgresfullg: {"order": 0, "name": "Postgres Full w/ Green", "class": "TaxiViaPostgresSeconds", "params": {"db": "taxifullg", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1"}}
postgresfull:
postgres12:
#postgres12: {"order": 2, "name": "Postgres 1/12 Shuffled", "class": "TaxiViaPostgres", "params": {"db": "taxi12r", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1"}}
mongofull:
mongo12r:
mongo12:
mongo:
tangelo:
"""

hostip = os.popen("netstat -nr | grep '^0\.0\.0\.0' | awk '{print $2}'").read()
cfg = cfg.replace('%HOSTIP%', hostip.strip()).strip()
cfg = cfg.replace('%ROOTPATH%', rootPath)
print cfg
