import calendar
import csv
import json
import sys
import time

sptr = csv.reader(open(sys.argv[1]))
header = [key.strip().replace(' ', '').lower() for key in sptr.next()]
header[0] = 'date'
header = header[:5]
list = []
allKeys = {}
baseTime = calendar.timegm(time.struct_time((2013, 1, 1, 0, 0, 0, 0, 0, 0)))
for line in sptr:
    info = {}
    for col in xrange(len(header)):
        key = header[col]
        if col == 0:
            key = 'date'
            value = baseTime + (int(line[col]) - 1) * 3600
        else:
            if line[col] == 'NA':
                value = 0
            else:
                value = round(float(line[col]), 4)
        info[key] = value
    list.append(info)
    allKeys.update(info)
keys = sorted(allKeys.keys())
result = {
    'fields': keys,
    'columns': {skey: keys.index(skey) for skey in keys},
    'data': [[line.get(skey, None) for skey in keys] for line in list]
}
print json.dumps(result, separators=(',', ':'), sort_keys=True)
