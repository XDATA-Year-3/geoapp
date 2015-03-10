Databases
---------

For testing purposes, I have loaded the taxi data into several different
databases.  For speedier testing, a randomly-sampled 1/12 subset of the data
has been tested in a wide variety of databases.  The full data set has been put
into a smaller number of databases.  For Mongo and Postgres, the databaases are
on a Windows computer.  The taxi program is running on an Ubuntu virtualbox
hosted on that Windows computer.

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
  **M2C**, converted to a postgresql table and using psycopg2,

* **Postgres Full Shuffled, pgdb (PyD)** - This is the exact dataset loaded for
  **M2D**, converted to a postgresql table and using psycopg2.


Speed Comparison
================

Databases perform better if the data they are accessing has been loaded
recently, since the data is then either in the database server's memory or in
operating system's file cache.  For each query, I've listed a cold time and a
warm time.  For each of these, at least three tests were run and averaged.  For
the cold times, the database service was stopped, the database server's file
system cache was flushed, and the service was restarted.

Times are in seconds (lower is better).

============ ===== ==== ==== ==== ==== ==== ====  === === ===== ====  ========
Test         State M2A  M2B  M2C  M3C  PgC  PyC   M2D M3D PgD   PyD   Comments
============ ===== ==== ==== ==== ==== ==== ====  === === ===== ====  ========
Week in Feb. Cold  18.0 19.3  3.3  3.7 38.0 30.2           28.3 27.0  297107 trips, 2013-2-17 - 2013-2-24
             Warm   5.0  3.0  3.1  4.0  5.7  5.0            8.8  8.0
All of Feb.  Cold  29.8 39.3 99.5 47.1 12.9 12.0           13.7 12.6
             Warm   5.1 35.6 22.5 28.9  4.8  4.0            4.8  4.1
Entire data  Cold  31.5  3.5 10.4  9.2  9.3  8.3            9.4  8.4
             Warm   4.9  3.5  3.0  3.3  3.3  2.6            3.3  2.5
9Y64 Med.    Cold  31.0 12.9 13.8  8.4 13.6 13.3          103.9 92.4
             Warm   1.0  1.0  1.0  1.0  1.0  1.0            1.3  1.2
============ ===== ==== ==== ==== ==== ==== ====  === === ===== ====  ========


Memory Comparison
=================


Load Time Comparison
====================

A substantial difference between Mongo and Postgres is the time it takes to
load and index the initial database.

Mongo 2.6 1/12 load time: 718s for load, 1175s for indices.
Mongo 3   1/12 load time: 405s for load, 688s for indices.
Postgres  1/12 load time: 603s for load, 170s for indices.

Mongo 2.6 full load time: 8715s for load, 191958s for indices.
Mongo 3   full load time: 5039s for load, 34305s for indices.
Postgres  full load time: 6149s for entire load including indices.


Raw times
=========
M2A - week: cold: 24.1, 14.9, 15.1, warm: 4.9, 5.0, 4.9, 5.1, 5.0
M2B - week: cold: 20.4, 18.4, 19.0, warm: 3.1, 2.9, 3.0, 3.0, 3.0
M2C - week: cold: 3.4, 3.3, 3.3, warm: 3.1, 3.2, 3.1, 3.2, 3.2
M3C - week: cold: 3.6, 3.7, 3.7, warm: 3.5, 3.5, 3.7, 3.7, 3.6
PgC - week: cold: 29.9, 47.2, 37.0, warm: 5.7, 5.9, 5.7, 5.6, 5.5
PyC - week: cold: 29.1, 23.6, 37.8, warm: 5.0, 4.9, 5.0, 5.0, 5.1
M2D - week: cold: , warm: 
M3D - week: cold: , warm:
PgD - week: cold: 29.6, 27.6, 27.5, warm: 8.6, 8.9, 8.8, 8.8, 8.8
PyD - week: cold: 29.3, 28.1, 25.9, warm: 8.0, 8.0, 7.9, 8.1, 8.2

M2A - feb: cold: 19.9, 41.2, 28.4, warm: 5.2, 5.1, 5.2, 5.2, 5.1
M2B - feb: cold: 64.1, 24.6, 29.4, warm: 27,0, 35.7, 39.5, 48.7, 26.9
M2C - feb: cold: 107.7, 94.9, 95.7, warm: 26.2, 21.8, 22.5, 21.5, 20.5
M3C - feb: cold: 61.5, 41.5, 38.4, warm: 24.2, 26.0, 23.8, 29.7, 40.5
PgC - feb: cold: 13.0, 12.6, 13.1, warm: 4.9, 4.7, 4.8, 4.8, 4.7
PyC - feb: cold: 12.2, 11.9, 11.9, warm: 3.9, 4.0, 4.1, 4.1, 4.0
M2D - feb: cold: , warm: 
M3D - feb: cold: , warm: 
PgD - feb: cold: 14.0, 13.3, 13.9, warm: 4.7, 4.8, 4.8, 4.8, 4.8
PyD - feb: cold: 12.8, 12.3, 12.6, warm: 4.6, 4.0, 4.1, 4.0, 4.0

M2A - full: cold: 28.2, 29.6, 36.6, warm: 4.9, 4.7, 5.0, 4.8, 4.9
M2B - full: cold: 3.5, 3.5, 3.5, warm: 3.8, 3.5, 3.4, 3.5, 3.4
M2C - full: cold: 9.8, 10.3, 11.2, warm: 3.0, 3.0, 3.0, 3.0, 3.0
M3C - full: cold: 9.2, 9.1, 9.3, warm: 3.2, 3.4, 3.3, 3.4, 3.1
PgC - full: cold: 9.4, 9.2, 9.4, warm: 3.3, 3.3, 3.4, 3.3, 3.3
PyC - full: cold: 8.3, 8.3, 8.4 warm: 2.4, 2.5, 2.5, 3.3, 2.4
M2D - full: cold: , warm: 
M3D - full: cold: , warm: 
PgD - full: cold: 9.4, 9.4, 9.4, warm: 3.3, 3.3, 3.3, 3.3, 3.2
PyD - full: cold: 8.5, 8.3, 8.4, warm: 2.5, 2.5, 2.5, 2.4, 2.4

M2A - med: cold: 50.6, 22.6, 19.8, warm: 1.1, 1.0, 1.0, 1.0, 1.0
M2B - med: cold: , warm:
M2C - med: cold: , warm:
M3C - med: cold: , warm: 
PgC - med: cold: 13.7, 13.2, 13.8, warm: 1.0, 1.0, 1.0, 1.0, 1.0
PyC - med: cold: 13.1, 13.4, 13.4, warm: 1.0, 1.0, 1.0, 1.0, 1.0
M2D - med: cold: , warm:
M3D - med: cold: , warm: 
PgD - med: cold: 121.2, 97.9, 92.5, warm: 1.3, 1.3, 1.3, 1.2, 1.3
PyD - med: cold: 91.6, 94.4, 91.1, warm: 1.2, 1.2, 1.3, 1.3, 1.2
