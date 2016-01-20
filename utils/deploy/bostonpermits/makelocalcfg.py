#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os

rootPath = os.environ['KWDEMO_KEY']

cfg = """
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
%FULL%taxijuly: {"order": 0, "name": "Combined July Data", "class": "TaxiViaPostgresRandom", "params": {"db": "taxijuly", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}, "access": "taxirandom"}
%FULL%postgresfullg: {"order": 1, "name": "Postgres Full w/ Green", "class": "TaxiViaPostgresSeconds", "params": {"db": "taxifullg", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}
%LIMITED%postgresfullg:
%LOCAL%postgresfullg: {"order": 0, "name": "Postgres Full w/ Green", "class": "TaxiViaPostgresSeconds", "params": {"db": "taxifullg", "host": "parakon", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}

%FULL%postgres12:
%LIMITED%postgres12: {"order": 2, "name": "Postgres 1/12 Shuffled", "class": "TaxiViaPostgres", "params": {"db": "taxi12r", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}
%LOCAL%postgres12:

postgresfull:
mongofull:
mongo12r:
mongo12:
mongo:
tangelo:

[instagramdata]
%FULL%postgres: {"order": 1, "name": "Instagram and Twitter", "class": "InstagramViaPostgres", "params": {"db": "instatwitter", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}
%FULL%msgjuly: {"order": 0, "name": "July Messages", "class": "MessageViaPostgres", "access": "message", "params": {"db": "msgjuly", "host": "%HOSTIP%", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}
%LIMITED%postgres:
%LOCAL%postgres: {"order": 0, "name": "Instagram and Twitter", "class": "InstagramViaPostgres", "params": {"db": "instatwitter", "host": "parakon", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}

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

[global]
server.socket_port: 8080
tools.proxy.on: True

[resources]
# The activityLog is where the Draper logging receiver is located.  If this
# optional module is not included, this parameter is irrelevant
# activityLogURI: "http://parakon:8021"
# activityLogMeta: "false"

#defaultYear: "2015"
#defaultStartDate: "2015-01-01"
#defaultEndDate: "2015-04-01"
recentMessages: {"pointColor": "#FF8000", "oldPointColor": "#FF0000", "recentOpacityBoost": 5, "recentPointCount": 0, "lessRecentPointCount": 1000, "recentPointTime": 300, "lessRecentPointTime": 300, "recentRadius": 7.5}

# fields are the comma-separated fields loaded into javascript
panels: [{"key":"permit", "name":"permit", "names":"permits", "capname":"Permit", "capnames":"Permits", "title":"Boston Permits", "description":"Building permits in Boston", "controls":[{"key":"comments", "type":"search", "name": "comments"}, {"key":"permittypedescr", "type":"search", "name": "permittypedescr"}, {"key":"occupancytype", "type":"search", "name": "occupancytype"}, {"key":"description", "type":"search", "name": "description"}], "fields":"date,latitude,longitude", "color": "#d62728"}, {"key":"crime", "name":"crime", "names":"crimes", "capname":"Crime", "capnames":"Crimes", "title":"Boston Crimes", "description":"Crimes in Boston", "controls":[{"key":"category", "type":"search", "name": "Category"}], "fields":"date,latitude,longitude,category", "color": "#2ca02c"}, {"key":"violation", "name":"violation", "names":"violations", "capname":"Violation", "capnames":"Violations", "title":"Boston Violations", "description":"Violations in Boston", "controls":[{"key":"category", "type":"search", "name": "Category"}], "fields":"date,latitude,longitude,category", "color": "#1f77b4"}]

# Each entry in this section is an available database.  The order is by lowest
# "order" value, then alphabetically for ties.  Each entry consists of {"name":
# (name shown to the user), "class": (internal database class, such as
# TaxiViaPostgres), "params": (database specific parameters)}
[taxidata]
taxijuly: {"order": 0, "name": "Combined July Data", "class": "TaxiViaPostgresRandom", "params": {"db": "taxijuly", "host": "parakon", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}, "access": "taxirandom"}
postgresfullg: {"order": 1, "name": "Postgres Full w/ Green", "class": "TaxiViaPostgresSeconds", "params": {"db": "taxifullg", "host": "parakon", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}
mongo12:
mongo:
tangelo:

[instagramdata]
postgres: {"order": 2, "name": "Instagram and Twitter", "class": "InstagramViaPostgres", "params": {"db": "instatwitter", "host": "10.0.2.2", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}
#postgres: {"order": 0, "name": "Instagram Syria", "class": "InstagramViaPostgres", "params": {"db": "syria", "host": "parakon", "user": "taxi", "password": "taxi#1"}}
#postgres: {"order": 0, "name": "Instagram", "class": "InstagramViaPostgres", "params": {"db": "instagram", "host": "parakon", "user": "taxi", "password": "taxi#1"}}
#postgres: {"order": 0, "name": "Instagram Late 2013", "class": "InstagramViaPostgres", "params": {"db": "instagramny", "host": "parakon", "user": "taxi", "password": "taxi#1"}}
#postgres: {"order": 0, "name": "Combined Instagram and Twitter", "class": "InstagramViaPostgres", "params": {"db": "instagramc", "host": "parakon", "user": "taxi", "password": "taxi#1"}}
#postgres: {"order": 0, "name": "Twitter", "class": "InstagramViaPostgres", "params": {"db": "twitter", "host": "parakon", "user": "taxi", "password": "taxi#1"}}
#postgres:
rtmsg: {"order": 1, "name": "Real Time Messages", "class": "RealTimeViaPostgres", "access": "message", "poll": 10, "params": {"db": "rtmsg", "host": "10.0.2.2", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}
msgjuly: {"order": 0, "name": "July Messages", "class": "MessageViaPostgres", "access": "message", "params": {"db": "msgjuly", "host": "10.0.2.2", "user": "taxi", "password": "taxi#1", "options": "-c statement_timeout=150000"}}
baltes: {"order": 3, "name": "Baltimore Elasticsearch", "class": "MessageRealTimeViaElasticsearch", "access": "message", "poll": 10, "params": {"hosts": [{'host': '10.1.93.172', 'port': 80, 'url_prefix': '/es94-103/instagram_remap', 'timeout': urllib3.Timeout(read=150, connect=10)}], "filters": [{'term': {'_type': 'baltimore'}}], "livetime": 1800, "datefield": "created_time", "tracktime": 3600}}
qcrnov: {"order": 4, "name": "QCR November", "class": "MessageRealTimeViaElasticsearch", "access": "message", "poll": 10, "params": {"hosts": ['https://memex:3vYAZ8bSztbxmznvhD4C@els.istresearch.com:59200/prod-darpa-*'], 'timeout': urllib3.Timeout(read=150, connect=10), "filters": [{'term': {'_type': 'gnip_tweet'}}], "livetime": 1800, "tracktime": 3600, "format": "gnip"}}
#baltes: {"order": 3, "name": "Baltimore Elasticsearch", "class": "MessageRealTimeViaElasticsearch", "access": "message", "poll": 10, "params": {"hosts": [{'host': '10.1.93.172', 'port': 80, 'url_prefix': '/es94-103/instagram_remap', 'timeout': urllib3.Timeout(read=150, connect=10)}], "livetime": 1800, "datefield": "created_time", "tracktime": 3600}}

[permitdata]
bostonpermit: {"order": 0, "name": "Boston Permits", "class": "DataViaMongo", "params": {"dbUri": "mongodb://%HOSTIP%:27017/boston", "collection": "permits", "keytable": {"date": "issued_date", "latitude": "plat", "longitude": "plon", "comments": "comments", "description": "description"}, "refname": "permit"}}

[violationdata]
bostonviolation: {"order": 0, "name": "Boston Violations", "class": "DataViaMongo", "params": {"dbUri": "mongodb://%HOSTIP%:27017/boston", "collection": "violations", "keytable": {"date": "status_dttm", "latitude": "plat", "longitude": "plon", "category": "description"}, "refname": "violation"}}

[crimedata]
bostoncrime: {"order": 0, "name": "Boston Permits", "class": "DataViaMongo", "params": {"dbUri": "mongodb://%HOSTIP%:27017/boston", "collection": "crime", "keytable": {"date": "fromdate", "latitude": "plat", "longitude": "plon", "category": "incident_type_description"}, "refname": "crime"}}

[controls]
#taxi-filter: {"ga-pickup-date": "2013-1-1 - 2013-1-1", "ga-data-trips": 1000}
#taxi-display: {"ga-show-taxi-data": False}
#general-display: {"ga-tile-set": "tonerlite"}
# A degree larger vertically and two degrees wider horizontally than the
# country extents.
#map: {"x0": 34.62, "y0": 38.11, "x1": 43.36, "y1": 31.31}
remove: {"ga-taxi-settings-panel": True, "ga-instagram-settings-panel": True}

[datasets]
# taxidata: {"rest": "taxi", "class": "findTaxi"}
# instagramdata: {"rest": "instagram", "class": "findInstagram"}
# messagedata: {"rest": "message", "class": "findMessage"}
permitdata: {"rest": "permit", "class": "findData", "sortkey": "_id", "fields": [('date', ('date', 'Permit Date')), ('latitude', ('float', 'Latitude')), ('longitude', ('float', 'Longitude')), ('comments', ('search', 'Comments')), ('permittypedescr', ('search', 'Type descr.')), ('occupancytype', ('search', 'Occupancy type')), ('description', ('search', 'Description'))]}
violationdata: {"rest": "violation", "class": "findData", "sortkey": "_id", "fields": [('date', ('date', 'Violation Date')), ('latitude', ('float', 'Latitude')), ('longitude', ('float', 'Longitude')), ('category', ('search', 'Category'))]}
crimedata: {"rest": "crime", "class": "findData", "sortkey": "_id", "fields": [('date', ('date', 'Crime Date')), ('latitude', ('float', 'Latitude')), ('longitude', ('float', 'Longitude')), ('category', ('search', 'Category'))]}

[places]
#manhattan: {"order": 0, "name": "Manhattan", "title": "Show all of Manhattan", "x0": -74.0276489, "y0": 40.8304859, "x1": -73.9161453, "y1": 40.6877773}
#midtown: {"order": 1, "name": "Midtown", "title": "Show Midtown", "x0": -74.0140, "y0": 40.7730, "x1": -73.9588, "y1": 40.7320}
#timessq: {"order": 2, "name": "Times Sq.", "title": "Show Times Square", "x0": -74.0048904, "y0": 40.7687378, "x1": -73.9708862, "y1": 40.7435085}
#syria: {"order": 0, "name": "Syria", "title": "Show all of Syria", "x0": 33.62, "y0": 38.11, "x1": 44.36, "y1": 31.31}
#damascus: {"order": 1, "name": "Damascus", "title": "Show the Damascus region", "x0": 35.8184, "y0": 33.8020, "x1": 36.7553, "y1": 33.2072}
#aleppo: {"order": 2, "name": "Aleppo", "title": "Show the Aleppo region", "x0": 36.6444, "y0": 36.5235, "x1": 37.6422, "y1": 35.9106}

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

print cfg
