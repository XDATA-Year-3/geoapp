import os
import sys
import time
import urllib

import fileutil

query = 'http://localhost:8001/api/v1/taxi?offset=0&format=list&limit=300000&fields=pickup_datetime%2Cpickup_longitude%2Cpickup_latitude%2C&source='

queries = [
    '&pickup_datetime_min=2013-2-17&pickup_datetime_max=2013-2-24',
    '&pickup_datetime_min=2013-2-1&pickup_datetime_max=2013-3-1',
    '',
    '&medallion=9Y64',
]
dbs = [
    ('m2', 'mongo'),
    ('m2', 'mongo12'),
    ('m2', 'mongo12r'),
    ('m3', 'mongo12r'),
    ('pg', 'postgres12'),
    ('m2', 'mongofull'),
    ('m3', 'mongofull'),
    ('pg', 'postgresfull'),
    ]

def start_db(db):
    fileutil.clearFileCache(False)
    if db=='m2':
        os.system("c:\\mongodb\\start.bat 2>NUL >NUL")
    elif db=='m3':
        os.system("c:\\mongodb3\\start.bat 2>NUL >NUL")
    elif db=='pg':
        os.system("net start postgresql-x64-9.4 2>NUL >NUL")

def stop_db(db):
    if db=='m2':
        os.system("c:\\mongodb\\stop.bat 2>NUL >NUL")
    elif db=='m3':
        os.system("c:\\mongodb3\\stop.bat 2>NUL >NUL")
    elif db=='pg':
        os.system("net stop postgresql-x64-9.4 2>NUL >NUL")


fptr = open(sys.argv[1], "wb")
stop_db('m2')
stop_db('m3')
stop_db('pg')
for q in queries:
    for db, dbname in dbs:
        cold = []
        warm = []
        for iter in xrange(3):
            start_db(db)
            url = query + dbname + q
            if dbname == 'mongo12':
                url += '&sort=random'
            print dbname, q
            for retry in xrange(5):
                try:
                    starttime = time.time()
                    data = urllib.urlopen(url).read()
                except Exception:
                    continue
                if len(data) < 32768:
                    continue
                dur = time.time() - starttime
                cold.append(dur)
                print 'cold', dur, len(data)
                break
            if not iter:
                for warmiter in xrange(5):
                    for retry in xrange(5):
                        try:
                            starttime = time.time()
                            data = urllib.urlopen(url).read()
                        except Exception:
                            continue
                        if len(data) < 32768:
                            continue
                        dur = time.time() - starttime
                        warm.append(dur)
                        print 'warm', dur, len(data)
                        break
            stop_db(db)
        print dbname, q, sum(cold)/len(cold), sum(warm)/len(warm)
        fptr.write('%s %s cold %5.3f warm %5.3f cold %r warm %r\n' % (
            dbname, q, sum(cold)/len(cold), sum(warm)/len(warm), cold, warm))
fptr.close()
stop_db('m2')
stop_db('m3')
stop_db('pg')
start_db('m3')
start_db('pg')
