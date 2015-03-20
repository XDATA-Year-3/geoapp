# This fetches data from the database on Manthey's machine, culls undesireable
# data points, and outputs JSON suitable for the speed test file.

import json
import urllib

data = json.loads(urllib.urlopen("http://parakon:8001/api/v1/taxi?source=postgresfull&offset=0&format=list&limit=110000&fields=pickup_datetime%2Cpickup_longitude%2Cpickup_latitude%2Cdropoff_datetime%2Cdropoff_longitude%2Cdropoff_latitude").read())
newdata = []
for item in data['data']:
    x = item[data['columns']['pickup_longitude']]
    y = item[data['columns']['pickup_latitude']]
    if x < -73.9 - 4 or x > -73.9 + 4 or y < 40.75 - 4 or y > 40.75 + 4:
        continue
    x = item[data['columns']['dropoff_longitude']]
    y = item[data['columns']['dropoff_latitude']]
    if x < -73.9 - 4 or x > -73.9 + 4 or y < 40.75 - 4 or y > 40.75 + 4:
        continue
    newdata.append(item)
    if len(newdata) == 100000:
        break
data['data'] = newdata
data['datacount'] = len(newdata)
print json.dumps(data, separators=(',', ':'), sort_keys=False, default=str)
