import calendar
import csv
import json
import sys
import time

Properties = {
    'cloudcover':             {},
    'est':                    {'name': 'date',          'format': 'date'},
    'maxdewpointf':           {'name': 'dew_max'},
    'meandewpointf':          {'name': 'dew_mean'},
    'mindewpointf':           {'name': 'dew_min'},
    'events':                 {'format': 'text'},
    'maxhumidity':            {'name': 'humidity_max'},
    'meanhumidity':           {'name': 'humidity_mean'},
    'minhumidity':            {'name': 'humidity_min'},
    'precipitationin':        {'name': 'precipitation', 'format': 'float'},
    'maxsealevelpressurein':  {'name': 'pressure_max',  'format': 'float'},
    'meansealevelpressurein': {'name': 'pressure_mean', 'format': 'float'},
    'minsealevelpressurein':  {'name': 'pressure_min',  'format': 'float'},
    'maxtemperaturef':        {'name': 'temp_max'},
    'meantemperaturef':       {'name': 'temp_mean'},
    'mintemperaturef':        {'name': 'temp_min'},
    'maxvisibilitymiles':     {'name': 'visibility_max'},
    'meanvisibilitymiles':    {'name': 'visibility_mean'},
    'minvisibilitymiles':     {'name': 'visibility_min'},
    'winddirdegrees':         {'name': 'wind_direction'},
    'maxgustspeedmph':        {'name': 'wind_gust'},
    'maxwindspeedmph':        {'name': 'wind_max'},
    'meanwindspeedmph':       {'name': 'wind_mean'},
}

sptr = csv.reader(open(sys.argv[1]))
header = [key.strip().replace(' ', '').lower() for key in sptr.next()]
list = []
allKeys = {}
for line in sptr:
    info = {}
    for col in xrange(len(header)):
        prop = Properties.get(header[col], {})
        key = prop.get('name', header[col])
        form = prop.get('format', 'int')
        value = ''.join(line[col:col+1]).strip()
        try:
            if form == 'int':
                if value == '':
                    continue
                if '.' in value:
                    print 'Error', value, header[col], line
                value = int(value)
            elif form == 'float':
                if value == '':
                    continue
                if value == 'T':
                    value = 0.001
                value = float(value)
            elif form == 'date':
                when = calendar.timegm(time.strptime(value, '%Y-%m-%d'))
                info['date_start'] = when * 1000
                # info['date_end'] = when + 86400 * 1000
            info[key] = value
        except Exception:
            print 'Error', value, header[col], line
    if 'date' not in info or not info['date'].startswith('2013-'):
        continue
    list.append(info)
    allKeys.update(info)
keys = sorted(allKeys.keys())
result = {
    'fields': keys,
    'columns': {skey: keys.index(skey) for skey in keys},
    'data': [[line.get(skey, None) for skey in keys] for line in list]
}
print json.dumps(result, separators=(',', ':'), sort_keys=True)
