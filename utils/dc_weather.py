import calendar
import csv
import json
import sys
import time

sptr = csv.reader(open(sys.argv[1]))
header = [key.strip().replace(' ', '').lower() for key in sptr.next()]
weather = {}
for line in sptr:
    item = dict(zip(header, [val.strip() for val in line]))
    if not item['date'] in weather:
        weather[item['date']] = {}
    day = weather[item['date']]
    for key in item.keys():
        if item[key] != '-9999':
            if key not in day:
                day[key] = {}
            day[key][item[key]] = day[key].get(item[key], 0) + 1
days = sorted(weather.keys())
list = []
allKeys = {}
for day in days:
    item = weather[day]
    when = calendar.timegm(time.strptime(day, '%Y%m%d'))
    info = {'date_start': when * 1000, 'date': day, 'precipitation': 0}

    for wkey, ikey in [
            ('tmax', 'temp_max'), ('tmin', 'temp_min'), ('tobj', 'temp_mean')]:
        if wkey in item:
            tally = count = 0
            for val in item[wkey]:
                tally += float(val) * item[wkey][val]
                count += item[wkey][val]
            info[ikey] = round((tally / count) * 0.18 + 32, 3)
    info['temp_mean'] = round(
        (info.get('temp_mean', 0) + info['temp_min'] + info['temp_max']) /
        (3 if 'temp_mean' in info else 2), 3)
    for wkey, ikey in [
            ('prcp', 'precipitation'), ('wesf', 'snowfall')]:
        if wkey in item:
            tally = count = 0
            for val in item[wkey]:
                if val != '0':
                    tally += float(val) * item[wkey][val]
                    count += item[wkey][val]
            if count >= 8:
                info[ikey] = round((tally / count) / 254, 3)
    events = []
    for wkey, ekey in [
            ('wt01', 'fog'), ('wt02', 'fog'), ('wt03', 'thunder'),
            ('wt05', 'hail'), ('wt06', 'snow'), ('wt08', 'haze'),
            ('wt09', 'snow'), ('wt11', 'wind')]:
        if (wkey in item and '1' in item[wkey] and item[wkey]['1'] >= 5 and
                ekey not in events):
            events.append(ekey)
    if info.get('snowfall', 0) >= 0.01 and 'snow' not in events:
        events.append('snow')
    elif info.get('precipitation', 0) >= 0.01:
        events.append('rain')
    info['events'] = '-'.join(events)
    list.append(info)
    allKeys.update(info)
keys = sorted(allKeys.keys())
result = {
    'fields': keys,
    'columns': {skey: keys.index(skey) for skey in keys},
    'data': [[line.get(skey, None) for skey in keys] for line in list]
}
print json.dumps(result, separators=(',', ':'), sort_keys=True)
