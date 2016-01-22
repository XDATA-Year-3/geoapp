#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os

rootPath = os.environ['KWDEMO_KEY']

cfg = """
[application]
appTitle: "Minerva Permits"
appIcon: "minerva.png"

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
panels: [{"key":"permit", "name":"permit", "names":"permits", "capname":"Permit", "capnames":"Permits", "title":"Boston Permits", "description":"Building permits in Boston", "controls":[{"key":"comments_search", "type":"search", "name": "Comments"}, {"key":"permittypedescr_search", "type":"search", "name": "Permit Type"}, {"key":"occupancytype_search", "type":"search", "name": "Occupancy Type"}, {"key":"description_search", "type":"search", "name": "Description"}], "fields":"date,latitude,longitude", "color": "#d62728"}, {"key":"crime", "name":"crime", "names":"crimes", "capname":"Crime", "capnames":"Crimes", "title":"Boston Crimes", "description":"Crimes in Boston", "controls":[{"key":"category_search", "type":"search", "name": "Category"}], "fields":"date,latitude,longitude,category", "color": "#2ca02c"}, {"key":"violation", "name":"violation", "names":"violations", "capname":"Violation", "capnames":"Violations", "title":"Boston Violations", "description":"Violations in Boston", "controls":[{"key":"category_search", "type":"search", "name": "Category"}], "fields":"date,latitude,longitude,category", "color": "#1f77b4"}]

introduction: '''
  <p>Minerva Permits lets you explore permit, crime, and code violation data in Boston using data from the <a href="https://data.cityofboston.gov/" target="_blank">City of Boston</a>. Use the controls on the left to display points or a dynamically generated binned heatmap on the data, and to filter down your search to specific types of permits, crimes, or violations. The animation controls let you cycle through the queried data to view weekly or daily patterns.</p>
  <p>This application is <a href="https://github.com/XDATA-Year-3/geoapp" target="_blank">open source</a> and was built with <a href="http://resonant.kitware.com/" target="_blank">Kitware's Resonant</a> platform, including <a href="http://girder.readthedocs.org/" target="_blank">Girder</a> for data management and <a href="http://opengeoscience.github.io/geojs/examples/index.html" target="_blank">GeoJS</a> for scalable visualization.</p>
  <p><center><button class="btn btn-default" onclick="$('.modal').girderModal('close');">Explore</button></center></p>
  <p>Or start with one of these preconfigured visualizations:</p>
  <p><a href="#mapview?map=x0%3D-71.3325043%26y0%3D42.4180018%26x1%3D-70.8414917%26y1%3D42.2240005%26zoom%3D12.84&graph=series0%3Dinternal.fullrange%26type0%3Dline%26bin0%3Dday%26series1%3Dpermit.layer%252Cpermitsboston.permits_total_est_buildings%26type1%3Dline%26bin1%3Dmonth%26series2%3Dpermit.layer%252Cpermitsboston.permits_total_est_buildings%26type2%3Dscatter%26bin2%3Dmonth&permit-filter=ga-permit-source%3Dbostonpermit%26ga-permit-permittypedescr_search%3DErect%252FNew%2BConstruction%26ga-permit-occupancytype_search%3Dfam%257Cmulti%257Cother%257Cunit%257Cmore%26ga-data-permit%3D1000000&panels=ga-anim-settings%3Dtrue%26ga-violation-settings%3Dfalse%26ga-crime-settings%3Dfalse&general-filter=ga-region%3D&general-display=ga-tile-set%3Dmapbox%26ga-tile-opacity%3D0.65&permit-display=ga-show-permit-data%3Dtrue%26ga-display-permit-process%3Draw%26ga-display-max-permit-points%3D1000000%26ga-display-permit-num-bins%3D15%26ga-permit-opacity%3D0.328&crime-display=ga-show-crime-data%3Dfalse%26ga-display-crime-process%3Draw%26ga-display-max-crime-points%3D25000%26ga-display-crime-num-bins%3D15%26ga-crime-opacity%3D0.1&violation-display=ga-show-violation-data%3Dfalse%26ga-display-violation-process%3Draw%26ga-display-max-violation-points%3D25000%26ga-display-violation-num-bins%3D15%26ga-violation-opacity%3D0.1">Predicting new construction</a> - From the raw city data, this view attempts to reconstruct the <a href="http://www.census.gov/construction/nrc/index.html" target="_blank">U.S. Census new residential construction estimates</a> by restricting the permits displayed on the map. The monthly correlation between the true and reconstructed data can be viewed on the left both as a timeline and scatterplot. Can you verify using the satellite view that these are indeed new residential construction sites? Can you adjust the query parameters to obtain a closer match?</p>
  <p><a href="#mapview?permit-filter=ga-permit-source%3Dbostonpermit%26ga-permit-comments_search%3Ddemolish%257Cdemolition%26ga-data-permit%3D1000000&panels=ga-anim-settings%3Dfalse%26ga-violation-settings%3Dtrue%26ga-crime-settings%3Dfalse&violation-filter=ga-violation-source%3Dbostonviolation%26ga-violation-category_search%3DUnsafe%2Bstructure%26ga-data-violation%3D1000000&general-filter=ga-region%3D&general-display=ga-tile-set%3Dmapbox%26ga-tile-opacity%3D0.65&permit-display=ga-show-permit-data%3Dtrue%26ga-display-permit-process%3Dbinned%26ga-display-max-permit-points%3D1000000%26ga-display-permit-num-bins%3D20%26ga-permit-opacity%3D0.328&crime-display=ga-show-crime-data%3Dfalse%26ga-display-crime-process%3Draw%26ga-display-max-crime-points%3D25000%26ga-display-crime-num-bins%3D15%26ga-crime-opacity%3D0.1&violation-display=ga-show-violation-data%3Dtrue%26ga-display-violation-process%3Dbinned%26ga-display-max-violation-points%3D1000000%26ga-display-violation-num-bins%3D20%26ga-violation-opacity%3D0.1&graph=series0%3Dinternal.fullrange%26type0%3Dline%26bin0%3Dday%26series1%3Dpermit.layer%252Cviolation.layer%26type1%3Dline%26bin1%3Dmonth%26series2%3Dpermit.layer%252Cviolation.layer%26type2%3Dscatter%26bin2%3Dmonth&map=x0%3D-71.1233521%26y0%3D42.3764805%26x1%3D-70.9765320%26y1%3D42.3184923%26zoom%3D14.58">Correlating demolition with unsafe structures</a> - In this view, red represents demolition permits, and blue represents unsafe structure code violations. A mixture (purple) shows areas where both demolition and unsafe structures are abundant, while strong red or blue designates areas where only demolition or unsafe structures are predominant. What areas are seeing reconstruction of aging buildings (predominantly purple)? What areas are seeing unsafe structures that are not being revitalized (predominately blue)? Can you find any specific locations where a site is cited as an unsafe structure and is later issued a permit for demolition?</p>
  <p><a href="#mapview?permit-filter=ga-permit-source%3Dbostonpermit%26ga-permit-comments_search%3Ddemolish%257Cdemolition%26ga-data-permit%3D1000000&panels=ga-anim-settings%3Dtrue%26ga-violation-settings%3Dtrue%26ga-crime-settings%3Dfalse%26ga-permit-settings%3Dfalse&general-display=ga-tile-set%3Dmapbox%26ga-tile-opacity%3D0.65&permit-display=ga-show-permit-data%3Dfalse%26ga-display-permit-process%3Dbinned%26ga-display-max-permit-points%3D1000000%26ga-display-permit-num-bins%3D20%26ga-permit-opacity%3D0.328&crime-display=ga-show-crime-data%3Dfalse%26ga-display-crime-process%3Draw%26ga-display-max-crime-points%3D25000%26ga-display-crime-num-bins%3D15%26ga-crime-opacity%3D0.1&violation-display=ga-show-violation-data%3Dtrue%26ga-display-violation-process%3Draw%26ga-display-max-violation-points%3D1000000%26ga-display-violation-num-bins%3D20%26ga-violation-opacity%3D0.012&graph=series0%3Dinternal.fullrange%26type0%3Dline%26bin0%3Dday%26series1%3Dviolation.layer%26type1%3Dline%26bin1%3Dmonth&violation-filter=ga-violation-source%3Dbostonviolation%26ga-violation-category_search%3Dtrash%253A%2Bres%26ga-data-violation%3D1000000&general-filter=ga-region%3D&map=x0%3D-71.1745148%26y0%3D42.3915918%26x1%3D-70.9750977%26y1%3D42.3128423%26zoom%3D14.14&anim=ga-cycle%3Dweek%26ga-cycle-group%3Dday%26ga-cycle-duration%3D10-s%26ga-cycle-framerate%3D30%26ga-play%3Dstop">Residential trash violations</a> - This view animates the residential code violations for misplacement of trash using a weekly cycle. Wait for the full data to load then press Play to show the animation. Can you determine the likely trash pickup dates for various Boston neighborhoods?</P>
  '''

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
