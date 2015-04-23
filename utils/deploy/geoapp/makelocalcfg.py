#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os

rootPath = os.environ['KWDEMO_KEY']

data = {
    'LIMITED': os.environ.get('LIMITED_DATA', '') == 'true',
    'LOCAL': os.environ.get('LIMITED_DATA', '') == 'local',
    'FULL': True
}
for key in data:
    if data[key] and key != 'FULL':
        data['FULL'] = False

cfg = """
[global]
server.socket_port: 8080
tools.proxy.on: True

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
%FULL%activityLogURI: "http://10.1.93.208"
%LIMITED%activityLogURI:
%LOCAL%activityLogURI:

# Each entry in this section is an available database.  The order is by lowest
# "order" value, then alphabetically for ties.  Each entry consists of {"name":
# (name shown to the user), "class": (internal database class, such as
# TaxiViaPostgres), "params": (database specific parameters)}
[taxidata]
%FULL%postgresfullg: {"order": 0, "name": "Postgres Full w/ Green", "class": "TaxiViaPostgresSeconds", "params": {"db": "taxifullg", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1"}}
%LIMITED%postgresfullg:
%LOCAL%postgresfullg: {"order": 0, "name": "Postgres Full w/ Green", "class": "TaxiViaPostgresSeconds", "params": {"db": "taxifullg", "host": "parakon", "user": "taxi", "password": "taxi#1"}}

%FULL%postgres12:
%LIMITED%postgres12: {"order": 2, "name": "Postgres 1/12 Shuffled", "class": "TaxiViaPostgres", "params": {"db": "taxi12r", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1"}}
%LOCAL%postgres12:

postgresfull:
mongofull:
mongo12r:
mongo12:
mongo:
tangelo:

[instagramdata]
%FULL%postgres: {"order": 0, "name": "Postgres", "class": "InstagramViaPostgres", "params": {"db": "instagram", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1"}}
%LIMITED%postgres:
%LOCAL%postgres: {"order": 0, "name": "Postgres", "class": "InstagramViaPostgres", "params": {"db": "instagram", "host": "parakon", "user": "taxi", "password": "taxi#1"}}
"""

hostip = os.popen("netstat -nr | grep '^0\.0\.0\.0' | awk '{print $2}'").read()
cfg = cfg.replace('%HOSTIP%', hostip.strip()).strip()
cfg = cfg.replace('%ROOTPATH%', rootPath)
for key in data:
    cfg = cfg.replace('%' + key + '%', '' if data[key] else '#')

print cfg
