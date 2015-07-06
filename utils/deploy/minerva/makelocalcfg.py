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
%FULL%taxijuly: {"order": 0, "name": "Combined July Data", "class": "TaxiViaPostgresRandom", "params": {"db": "taxijuly", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1"}, "access": "taxirandom"}
%FULL%postgresfullg: {"order": 1, "name": "Postgres Full w/ Green", "class": "TaxiViaPostgresSeconds", "params": {"db": "taxifullg", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1"}}
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
%FULL%postgres: {"order": 1, "name": "Instagram and Twitter", "class": "InstagramViaPostgres", "params": {"db": "instatwitter", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1"}}
%FULL%msgjuly: {"order": 0, "name": "July Messages", "class": "RealTimeViaPostgres", "access": "message", "params": {"db": "msgjuly", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1"}}
%LIMITED%postgres:
%LOCAL%postgres: {"order": 0, "name": "Instagram and Twitter", "class": "InstagramViaPostgres", "params": {"db": "instatwitter", "host": "parakon", "user": "taxi", "password": "taxi#1"}}

[regions]
nyc: {"name": "New York City", "region": "nyc"}
boston: {"name": "Boston", "region": "boston"}
dc: {"name": "Washington D.C.", "region": "dc"}

[places]
greater: {"order": 0, "name": "Greater NYC", "title": "Show NYC including surrounding airports", "x0": -74.1670456, "y0": 40.8645278, "x1": -73.7660294, "y1": 40.5900000}
manhattan: {"order": 3, "name": "Manhattan", "title": "Show all of Manhattan", "x0": -74.0276489, "y0": 40.8304859, "x1": -73.9161453, "y1": 40.6877773}
dcarea: {"order": 2, "name": "Greater DC", "title": "Show Washington D.C. and the surrounding area", "x0": -77.211, "y0": 39.022, "x1": -76.861, "y1": 38.756}
dcctr: {"order": 5, "name": "Center DC", "title": "Show downtown Washington D.C.", "x0": -77.057, "y0": 38.926, "x1": -76.994, "y1": 38.883}
bostonarea: {"order": 1, "name": "Boston Area", "title": "Show Boston including the surrounding area", "x0": -71.243, "y0": 42.561, "x1": -70.766, "y1": 42.192}
bostonctr: {"order": 4, "name": "Boston Ctr.", "title": "Show the central Boston area", "x0": -71.108, "y0": 42.369, "x1": -71.049, "y1": 42.331}
"""

hostip = os.popen("netstat -nr | grep '^0\.0\.0\.0' | awk '{print $2}'").read()
cfg = cfg.replace('%HOSTIP%', hostip.strip()).strip()
cfg = cfg.replace('%ROOTPATH%', rootPath)
for key in data:
    cfg = cfg.replace('%' + key + '%', '' if data[key] else '#')

print cfg
