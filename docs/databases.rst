Databases
---------

You may just care about the `Conclusions`_.

For the XDATA project, I needed to work with the New York City 2013 Taxi trip
data.  This data set consists of 173,179,759 records, each of which have 21
distinct properties.

For testing purposes, I have loaded the taxi data into several different
databases.  For speedier testing, a randomly-sampled 1/12 subset of the data
(reducing the size to 14,434,412 records) has been tested in a wide variety of
databases.  The full data set has been put into a smaller number of databases.
For Mongo and Postgres, the databases are on a Windows computer.  The taxi
program is running on an Ubuntu virtualbox hosted on that Windows computer.

Mongo 2.6
=========

I have tried several different loading configurations in Mongo 2.6.4.

* **Mongo 1/12 Dates (M2A)** - Initially, I loaded the data 'as is' into Mongo.
  This included loading dates as ISODates and keeping the full keys in the
  database.  It turns out that a large amount of time was spend converting the
  Mongo BSON dates into python datetime structures, then converting the python
  datetimes into json serialized dates, after which these dates were converted
  to javascript Date objects.  This was not efficient.  The other defect in
  this data setup is that I could not easily get a pseudo-random set of data
  when the query would return a limited set.

* **Mongo 1/12 Random Value (M2B)** - Storing dates as integers eliminates all
  of the conversion time.  The dates are converted into epoch milliseconds upon
  ingest.  This integer is used throughout.  We want to load data so that if we
  can't load it all, it appears random.  I added a random number to each row so
  that, for large data sets, this could be used as a selector.  Mongo seeks
  excessively in when using this, which makes cold queries very slow.

* **Mongo 1/12 Shuffled (M2C)** - Loading the data in a shuffled order allows
  sorting by _id for pseudo-random selections.  This is much faster for cold
  queries.

* **Mongo Full Shuffled (M2D)** - I loaded the full data set in the shuffled
  order.

Mongo 3
=======

Mongo 3 introduced a new data store that uses a huge amount less disk space.
Their release notes claims it is faster in many instances, too.

* **Mongo 1/12 Shuffled (M3C)** - This is the same data set as **M2C**, loaded
  into Mongo 3 and stored using the new WiredTiger data store.

* **Mongo Full Shuffled (M3D)** - This is the same data set as **M2D**, loaded
  into Mongo 3 and stored using the new WiredTiger data sore.

Tangelo and SQLAlchemy
======================

* **Tangelo 1/12 (TA)** - Roni loaded the 1/12 subset into a SQL database and
  served it through Tangelo using SQLAlchemy.  This appeared around 10% slower
  than **M2A**, but we didn't investigate why.  My guess is that it the data
  was being needlessly converted multiple times, but it could have been slower
  for other reasons.

PostgreSQL
==========

* **Postgres 1/12 Shuffled, pgdb (PgC)** - This is the exact dataset loaded for
  **M2C**, converted to a postgresql table.  There are two python-postgres
  connector programs; this uses pgdb (PyGreSQL).

* **Postgres Full Shuffled, pgdb (PgD)** - This is the exact dataset loaded for
  **M2D**, converted to a postgresql table and using pgdb.

* **Postgres 1/12 Shuffled, pgdb (PyC)** - This is the exact dataset loaded for
  **M2C**, converted to a postgresql table and using psycopg2.

* **Postgres Full Shuffled, pgdb (PyD)** - This is the exact dataset loaded for
  **M2D**, converted to a postgresql table and using psycopg2.


Test Queries
============

Each test query was requested through the ``geoapp`` taxi interface.  Times
include both the database query and the handling of the data via python.  The
python program uses standard libraries for mongo (``pymongo``) and postgres
(either ``pgdb`` or ``psycopg2``), then converts the response to a json list of
lists with the resultant data.

For testing, I selected four typical queries:

* **A Week in February** - This requests up to 300,000 records for the time
  span between February 17, 2013 0:00 (inclusive) and February 24 0:00
  (exclusive), sorted in a pseudo-random manner if there are more than 300,000
  records so as to get a representative data set.  The query to the ``geoapp``
  program is
  ``/api/v1/taxi?offset=0&format=list&limit=300000&fields=pickup_datetime%2Cpickup_longitude%2Cpickup_latitude%2C&source=<database>&pickup_datetime_min=2013-2-17&pickup_datetime_max=2013-2-24``.

  For the 1/12th set databases (M2A, M2B, M2C, M3C, PgC, PyC), this returns
  297,107 records.

  For the full data set databases (M2D, M3D, PgD, PyD), this returns 300,000
  records out of a full set of 3,563,832.

  The query used in Mongo is
  ``{'pd': {'$gte': 1361059200000, '$lt': 1361664000000}}``, with projection
  fields of ``{'px': 1, 'py': 1, 'pd': 1, '_id': 0}``, a sort of ``{_id: 1}``, and
  a limit of 300,000.

  The SQL used in Postgres is
  ``SELECT pickup_datetime,pickup_longitude,pickup_latitude FROM trips WHERE true AND pickup_datetime>=1361059200000 AND pickup_datetime<1361664000000 ORDER BY _id ASC LIMIT 300000``.

* **All of February** - This requests up to 300,000 records from all of the
  data from February, sorted in a pseudo-random manner.  The query to the
  ``geoapp`` program is
  ``/api/v1/taxi?offset=0&format=list&limit=300000&fields=pickup_datetime%2Cpickup_longitude%2Cpickup_latitude%2C&source=<database>&pickup_datetime_min=2013-2-1&pickup_datetime_max=2013-3-1``.

  For the 1/12th set databases (M2A, M2B, M2C, M3C, PgC, PyC), this returns
  300,000 records out of a full set of 1,166,256.

  For the full data set databases (M2D, M3D, PgD, PyD), this returns 300,000
  records out of a full set of 13,990,176.

  The query used in Mongo is
  ``{'pd': {'$gte': 1359676800000, '$lt': 1362096000000}}``, with projection
  fields of ``{'px': 1, 'py': 1, 'pd': 1, '_id': 0}``, a sort of ``{_id: 1}``, and
  a limit of 300,000.

  The SQL used in Postgres is
  ``SELECT pickup_datetime,pickup_longitude,pickup_latitude FROM trips WHERE true AND pickup_datetime>=1359676800000 AND pickup_datetime<1362096000000 ORDER BY _id ASC LIMIT 300000``.

* **Entire Data** - This requests 300,000 pseudo-random records from the
  complete data set.  The query to the ``geoapp`` program is
  ``/api/v1/taxi?offset=0&format=list&limit=300000&fields=pickup_datetime%2Cpickup_longitude%2Cpickup_latitude%2C&source=<database>``.

  For the 1/12th set databases (M2A, M2B, M2C, M3C, PgC, PyC), this returns
  300,000 records out of a full set of 14,434,412.

  For the full data set databases (M2D, M3D, PgD, PyD), this returns 300,000
  records out of a full set of 173,179,759.

  The query used in Mongo is ``{}``, with projection fields of
  ``{'px': 1, 'py': 1, 'pd': 1, '_id': 0}``, a sort of ``{_id: 1}``, and a limit of
  300,000.
  
  The SQL used in Postgres is
  ``SELECT pickup_datetime,pickup_longitude,pickup_latitude FROM trips WHERE true ORDER BY _id ASC LIMIT 300000``.

* **Taxi Medallion 9Y64** - This requests up to the first 300,000 records for
  all trips by the taxi with medallion "9Y64" sorted in a pseudo-random manner.
  The query to the ``geoapp`` program is
  ``/api/v1/taxi?offset=0&format=list&limit=300000&fields=pickup_datetime%2Cpickup_longitude%2Cpickup_latitude%2C&source=<database>&medallion=9Y64``.

  For the 1/12th set databases (M2A, M2B, M2C, M3C, PgC, PyC), this returns
  1,416 records.

  For the full data set databases (M2D, M3D, PgD, PyD), this returns 17,182
  records.

  The query used in Mongo is ``{'m': u'9Y64'}``, with projection fields of
  ``{'px': 1, 'py': 1, 'pd': 1, '_id': 0}``, a sort of ``{_id: 1}``, and a limit of
  300,000.
  
  The SQL used in Postgres is
  ``SELECT pickup_datetime,pickup_longitude,pickup_latitude FROM trips WHERE true AND medallion=9Y64 ORDER BY _id ASC LIMIT 300000``.

For the M2B tests, an additional parameter of ``&sort=random`` was added to each
query.  In this case, a sort of ``{r: 1}`` was used.  The M2A database did not
have the ability to return data in a pseudo-random order.  In this case, a
sort parameter for the ``pickup_datetime`` was used.


Speed Comparison
================

Databases perform better if the data they are accessing has been loaded
recently, since the data is then either in the database server's memory or in
operating system's file cache.  For each query, I've listed a cold time and a
warm time.  For each of these, at least three tests were run and averaged.  For
the cold times, the database service was stopped, the database server's file
system cache was flushed, and the service was restarted.

Times are in seconds (lower is better).

============ ===== ==== ==== ==== ==== ==== ==== = ===== ===== ===== ====
..                  1/12th Databases                Full Databases
------------ ----- ----------------------------- - ----------------------
Test         State M2A  M2B  M2C  M3C  PgC  PyC    M2D   M3D   PgD   PyD
============ ===== ==== ==== ==== ==== ==== ==== = ===== ===== ===== ====
Week in Feb. Cold  18.0 19.3  3.3  3.7 38.0 30.2   326.4 193.0  28.3 27.0
..           Warm   5.0  3.0  3.1  4.0  5.7  5.0   101.6  99.9   8.8  8.0
All of Feb.  Cold  29.8 39.3 99.5 47.1 12.9 12.0   719.4  85.1  13.7 12.6
..           Warm   5.1 35.6 22.5 28.9  4.8  4.0    74.1  66.1   4.8  4.1
Entire data  Cold  31.5  3.5 10.4  9.2  9.3  8.3    12.1  11.0   9.4  8.4
..           Warm   4.9  3.5  3.0  3.3  3.3  2.6     3.0   3.4   3.3  2.5
9Y64 Med.    Cold  31.0 12.9 13.8  8.4 13.6 13.3   106.1  96.2 103.9 92.4
..           Warm   1.0  1.0  1.0  1.0  1.0  1.0     1.1   1.1   1.3  1.2
============ ===== ==== ==== ==== ==== ==== ==== = ===== ===== ===== ====


Memory Comparison
=================

The perceived memory usage between Mongo 2, Mongo 3, and Postgres are very
different.

Mongo 2 memory maps all of its database files.  The host OS loads the accessed
portion of these files into memory as they are used.  Because the files are
larger than the physical memory, and Mongo doesn't provide hinting as to the
order that parts of the files will be used, seeks are especially costly.
Eventually, Mongo will consume most of the memory on the machine.  This plays
plays poorly with other processes.

Mongo 3 can use the Mongo 2 file store and memory map.  When using the new
WiredTiger data store, it allegedly only loads the parts of the files that it
needs, letting the OS cache files as needed.  In practice, it still uses a
significant amount of memory for the Mongo process, and still wants to be the
only significant process on the machine.

Postgres relies entirely on the OS's file cache for disk efficiency.  It uses a
comparatively tiny amount of memory, even when forming large queries.  Although
having other disk-intensive processes will slow it down, it has a much smaller
footprint than Mongo.


Load Time Comparison
====================

A substantial difference between Mongo and Postgres is the time it takes to
load and index the initial database.

Mongo 2.6 (M2C) 1/12 load time: 718s for load, 1175s for indices.
Mongo 3   (M3C) 1/12 load time: 405s for load, 688s for indices.
Postgres  (PyC) 1/12 load time: 603s for load, 170s for indices.

Mongo 2.6 (M2D) full load time: 8715s for load, 191958s for indices.
Mongo 3   (M3D) full load time: 5039s for load, 34305s for indices.
Postgres  (PyD) full load time: 6149s for entire load including indices.


Disk Usage Comparison
=====================

Mongo 3 uses the least disk space, and Mongo 2 uses the most, with Postgres
between the two.

======== ==========
Database Disk Usage
======== ==========
M2A         12.8 Gb
M2B         12.8 Gb
M2C         12.8 Gb
M3C          2.7 Gb
PgC          3.5 Gb
..
M2D        126.5 Gb
M3D         25.5 Gb
PgD         42.8 Gb
======== ==========


Conclusions
===========

Based on these results, I have the following recommendations:

* Store times as integers.  It is faster and saves data conversions.

* For Postgres: use ``psycopg2`` rather than ``pgdb``.  ``pgdb`` has better
  datatype handling, but ``psycopg2`` is faster.

* For Mongo: use Mongo 3 with the WiredTiger datastore.  It is faster and uses
  less space and memory than Mongo 2.

* If you need pseudo-random data, ingest the data in the desired order rather
  than using a separate field and index for randomization.

* In general, if you have tabular data, use Postgres.  If you have data with no
  consistent scheme, use Mongo.

* Postgres is faster than Mongo 3 on tabular datasets up to at least this scale.
  The only exception to this is when queries
  that are indexed have small complete result sets (not just the number of
  records returned, but the total number without a limit).  Even in these
  cases, Postgres is nearly as fast as Mongo, whereas Mongo is frequently
  vastly slower than Postgres.

As a reminder, the correct indices are crucial for database performance.


Raw times
+++++++++

This gives some idea of the variability of the tests.  For each cold test, all
database services were stopped, the file system cache was dropped, and the
appropriate database service was restarted.  For the warm tests, immediately
after a cold test, the warm tests were run one after another.  All tests were
run when no other programs were being actively used in the system, but ordinary
background tasks still could occur.

========== =================== ===============================
Test       Cold times          Warm times
========== =================== ===============================
M2A - week 24.1, 14.9, 15.1    4.9, 5.0, 4.9, 5.1, 5.0
M2B - week 20.4, 18.4, 19.0    3.1, 2.9, 3.0, 3.0, 3.0
M2C - week 3.4, 3.3, 3.3       3.1, 3.2, 3.1, 3.2, 3.2
M3C - week 3.6, 3.7, 3.7       3.5, 3.5, 3.7, 3.7, 3.6
PgC - week 29.9, 47.2, 37.0    5.7, 5.9, 5.7, 5.6, 5.5
PyC - week 29.1, 23.6, 37.8    5.0, 4.9, 5.0, 5.0, 5.1
M2D - week 330.7, 317.9, 330.8 67.2, 116.2, 118.3, 96.4, 110.1
M3D - week 196.5, 216.5, 166.1 74.2, 76.6, 123.5, 103.0, 122.4
PgD - week 29.6, 27.6, 27.5    8.6, 8.9, 8.8, 8.8, 8.8
PyD - week 29.3, 28.1, 25.9    8.0, 8.0, 7.9, 8.1, 8.2
..
M2A - feb  19.9, 41.2, 28.4    5.2, 5.1, 5.2, 5.2, 5.1
M2B - feb  64.1, 24.6, 29.4    27,0, 35.7, 39.5, 48.7, 26.9
M2C - feb  107.7, 94.9, 95.7   26.2, 21.8, 22.5, 21.5, 20.5
M3C - feb  61.5, 41.5, 38.4    24.2, 26.0, 23.8, 29.7, 40.5
PgC - feb  13.0, 12.6, 13.1    4.9, 4.7, 4.8, 4.8, 4.7
PyC - feb  12.2, 11.9, 11.9    3.9, 4.0, 4.1, 4.1, 4.0
M2D - feb  753.6, 662.4, 742.3 83.5, 112.7, 75.6, 74.6, 23.9
M3D - feb  98.5, 98.3, 58.6    50.1, 40.0, 87.8, 80.6, 72.1
PgD - feb  14.0, 13.3, 13.9    4.7, 4.8, 4.8, 4.8, 4.8
PyD - feb  12.8, 12.3, 12.6    4.6, 4.0, 4.1, 4.0, 4.0
..
M2A - full 28.2, 29.6, 36.6    4.9, 4.7, 5.0, 4.8, 4.9
M2B - full 3.5, 3.5, 3.5       3.8, 3.5, 3.4, 3.5, 3.4
M2C - full 9.8, 10.3, 11.2     3.0, 3.0, 3.0, 3.0, 3.0
M3C - full 9.2, 9.1, 9.3       3.2, 3.4, 3.3, 3.4, 3.1
PgC - full 9.4, 9.2, 9.4       3.3, 3.3, 3.4, 3.3, 3.3
PyC - full 8.3, 8.3, 8.4       2.4, 2.5, 2.5, 3.3, 2.4
M2D - full 9.6, 14.4, 12.3     3.0, 2.9, 3.0, 3.1, 3.0
M3D - full 9.6, 9.3, 14.1      3.4, 3.4, 3.4, 3.4, 3.4
PgD - full 9.4, 9.4, 9.4       3.3, 3.3, 3.3, 3.3, 3.2
PyD - full 8.5, 8.3, 8.4       2.5, 2.5, 2.5, 2.4, 2.4
..
M2A - med  50.6, 22.6, 19.8    1.1, 1.0, 1.0, 1.0, 1.0
M2B - med  12.3, 12.1, 14.4    1.0, 1.0, 1.0, 1.0, 1.0
M2C - med  13.8, 13.8, 13.7    1.0, 1.0, 1.0, 1.0, 1.0
M3C - med  8.8, 8.8, 7.7       1.0, 1.0, 1.0, 1.0, 1.0
PgC - med  13.7, 13.2, 13.8    1.0, 1.0, 1.0, 1.0, 1.0
PyC - med  13.1, 13.4, 13.4    1.0, 1.0, 1.0, 1.0, 1.0
M2D - med  101.2, 102.9, 114.2 1.1, 1.1, 1.1, 1.1, 1.1
M3D - med  92.2, 102.4, 94.1   1.1, 1.1, 1.2, 1.1, 1.1
PgD - med  121.2, 97.9, 92.5   1.3, 1.3, 1.3, 1.2, 1.3
PyD - med  91.6, 94.4, 91.1    1.2, 1.2, 1.3, 1.3, 1.2
========== =================== ===============================


