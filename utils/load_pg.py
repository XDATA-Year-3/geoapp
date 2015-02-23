import json
import sys

import fileutil

KeyTable = {
    'medallion': 'm',
    'hack_license': 'h',
    'vendor_id': 'v',
    'rate_code': 'c',
    'store_and_fwd_flag': 'fw',
    'pickup_datetime': 'pd',
    'dropoff_datetime': 'dd',
    'passenger_count': 'p',
    'trip_time_in_secs': 's',
    'trip_distance': 'd',
    'pickup_longitude': 'px',
    'pickup_latitude': 'py',
    'dropoff_longitude': 'dx',
    'dropoff_latitude': 'dy',
    'payment_type': 'ty',
    'fare_amount': 'f',
    'surcharge': 'sr',
    'mta_tax': 'tx',
    'tip_amount': 'tp',
    'tolls_amount': 'tl',
    'total_amount': 't',
}


dptr = fileutil.OpenWithoutCaching(sys.argv[2], 'wb')
dptr.write("""DROP TABLE trips;

CREATE TABLE trips (
    medallion text,
    hack_license text,
    vendor_id text,
    rate_code int,
    store_and_fwd_flag text,
    pickup_datetime bigint,
    dropoff_datetime bigint,
    passenger_count int,
    trip_time_in_secs int,
    trip_distance real,
    pickup_longitude double precision,
    pickup_latitude double precision,
    dropoff_longitude double precision,
    dropoff_latitude double precision,
    payment_type text,
    fare_amount real,
    surcharge real,
    mta_tax real,
    tip_amount real,
    tolls_amount real,
    total_amount real,
    _id int
);

COPY trips (""")
keys = KeyTable.keys()
dptr.write(','.join(keys))
dptr.write(""",_id) FROM stdin;
""")
skeys = [KeyTable[key] for key in keys]
fptr = fileutil.OpenWithoutCaching(sys.argv[1])
processed = 0
for line in fptr:
    data = json.loads(line)
    data = [data[key] for key in skeys]
    data = ['\\N' if item is None else str(item) for item in data]
    dptr.write('\t'.join(data) + '\t%d\n' % processed)
    processed += 1
    if not (processed % 10000):
        sys.stderr.write('%d\r' % processed)
        sys.stderr.flush()
dptr.write("""\\.

CREATE INDEX id_idx ON trips (_id);
CREATE INDEX medallion_idx ON trips (medallion);
CREATE INDEX hack_license_idx ON trips (hack_license);
CREATE INDEX pickup_datetime_idx ON trips (pickup_datetime);
""")
dptr.close()
fptr.close()
sys.stderr.write('%d\n' % processed)
