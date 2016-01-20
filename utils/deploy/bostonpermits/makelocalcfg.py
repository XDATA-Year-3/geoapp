#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os

rootPath = os.environ['KWDEMO_KEY']

cfg = """
[application]
appTitle: "Minverva Permits"
appIcon: "icon.png"

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
defaultStartDate: "2009-01-01"
defaultEndDate: "2016-01-01"

initialload: True

# fields are the comma-separated fields loaded into javascript
panels: [{"key":"permit", "name":"permit", "names":"permits", "capname":"Permit", "capnames":"Permits", "title":"Boston Permits", "description":"Building permits in Boston", "controls":[{"key":"comments_search", "type":"search", "name": "comments"}, {"key":"permittypedescr_search", "type":"search", "name": "permittypedescr"}, {"key":"occupancytype_search", "type":"search", "name": "occupancytype"}, {"key":"description_search", "type":"search", "name": "description"}], "fields":"date,latitude,longitude", "color": "#d62728"}, {"key":"crime", "name":"crime", "names":"crimes", "capname":"Crime", "capnames":"Crimes", "title":"Boston Crimes", "description":"Crimes in Boston", "controls":[{"key":"category_search", "type":"search", "name": "Category"}], "fields":"date,latitude,longitude,category", "color": "#2ca02c"}, {"key":"violation", "name":"violation", "names":"violations", "capname":"Violation", "capnames":"Violations", "title":"Boston Violations", "description":"Violations in Boston", "controls":[{"key":"category_search", "type":"search", "name": "Category"}], "fields":"date,latitude,longitude,category", "color": "#1f77b4"}]

[regions]
nyc:
boston: {"name": "Boston", "region": "boston"}
dc:

[permitdata]
bostonpermit: {"order": 0, "name": "Boston Permits", "class": "DataViaMongo", "params": {"dbUri": "mongodb://%HOSTIP%:27017/boston", "collection": "permits", "keytable": {"date": "issued_date", "latitude": "plat", "longitude": "plon", "comments": "comments", "description": "description"}, "refname": "permit"}}

[violationdata]
bostonviolation: {"order": 0, "name": "Boston Violations", "class": "DataViaMongo", "params": {"dbUri": "mongodb://%HOSTIP%:27017/boston", "collection": "violations", "keytable": {"date": "status_dttm", "latitude": "plat", "longitude": "plon", "category": "description"}, "refname": "violation"}}

[crimedata]
bostoncrime: {"order": 0, "name": "Boston Permits", "class": "DataViaMongo", "params": {"dbUri": "mongodb://%HOSTIP%:27017/boston", "collection": "crime", "keytable": {"date": "fromdate", "latitude": "plat", "longitude": "plon", "category": "incident_type_description"}, "refname": "crime"}}

[controls]
map: {"x0": -71.186, "y0": 42.418, "x1": -70.988, "y1": 42.224}
remove: {"ga-taxi-settings-panel": True, "ga-instagram-settings-panel": True}

[datasets]
permitdata: {"rest": "permit", "class": "findData", "sortkey": "_random", "fields": [('date', ('date', 'Permit Date')), ('latitude', ('float', 'Latitude')), ('longitude', ('float', 'Longitude')), ('comments', ('search', 'Comments')), ('permittypedescr', ('search', 'Type descr.')), ('occupancytype', ('search', 'Occupancy type')), ('description', ('search', 'Description'))]}
violationdata: {"rest": "violation", "class": "findData", "sortkey": "_random", "fields": [('date', ('date', 'Violation Date')), ('latitude', ('float', 'Latitude')), ('longitude', ('float', 'Longitude')), ('category', ('search', 'Category'))]}
crimedata: {"rest": "crime", "class": "findData", "sortkey": "_random", "fields": [('date', ('date', 'Crime Date')), ('latitude', ('float', 'Latitude')), ('longitude', ('float', 'Longitude')), ('category', ('search', 'Category'))]}

[places]
bostonlarge: {"order": 0, "name": "Greater Bos.", "title": "Show Boston including a large surrounding area", "x0": -71.243, "y0": 42.561, "x1": -70.766, "y1": 42.192}
bostonarea: {"order": 1, "name": "Boston Area", "title": "Show Boston include a surrounding area", "x0": -71.186, "y0": 42.418, "x1": -70.988, "y1": 42.224}
bostonctr: {"order": 2, "name": "Boston Ctr.", "title": "Show the central Boston area", "x0": -71.108, "y0": 42.369, "x1": -71.049, "y1": 42.331}
"""

hostip = os.popen("netstat -nr | grep '^0\.0\.0\.0' | awk '{print $2}'").read()
cfg = cfg.replace('%HOSTIP%', hostip.strip()).strip()
cfg = cfg.replace('%ROOTPATH%', rootPath)

print cfg
