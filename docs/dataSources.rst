Data Sources
------------

Minerva Taxi can be configured to access different data sets.

Most of the current data is from 2012 - 2015, and is concentrated in New York City, Washington D.C., and Boston.  Some of the data sets available are:

Trip Data
=========

* **Taxicab Trips - NYC**
    All of the New York city trip data is from taxi cabs in 2013 or 2014.  This
    includes all yellow cab trips in Mahattan for 2013, and some of the green
    cab trips in the outer boroughs from mid 2013 to mid 2014.  The data
    includes pickup and dropoff  locations and time, plus a variety of other
    data.  Around 173 million yellow cab trips and 6 millions green cab trips
    are in the database.

    Note that the yellow cab information is missing about half of the data for
    some days in August 2013.

* **Taxicab Trips - Boston**
    This includes late night taxi pickups and dropoffs that are not in
    residential areas from 2012 through May of 2014.

* **Bike Share Trips - Washington D.C.**
    This data is from publicly available bicycles.  There are 378 distinct
    bicycle stations, and the data consists of trips between them for 2013
    through the first quarter of 2015.

Message Data
============

* **Instagram Messages**
    This is a subset of Instagram messages that were sent in the greater New
    York, Washington D.C., and Boston areas.  There are around 7.5 million
    messages from NYC, 1.0 million from D.C., and 0.5 million from Boston.

* **Twitter Messages**
    This is a subset of Twitter messages that were sent in the greater New York
    York, Washington D.C., and Boston areas.  There are around 31 million
    messages from NYC, 2.5 million from D.C., and 4.5 million from Boston.

Graph Data
==========

There is some additional data that can be plotted on graphs, but not on the map:

Weather
+++++++

* **Weather - Central Park, NYC**
    There is daily information on temperature, precipitation and other values.

* **Weather - Boston**
    There is daily information on temperature, precipitation and other values.

* **Weather - D.C.**
    There is daily information on temperature, precipitation and other values.  The data was collected from multiple weather stations and, where appropriate, averaged together.

Travel Statistical Models
+++++++++++++++++++++++++

* **NYC Taxi Statistical Trends**
    The yellow taxi activity from 2013 was processed using a statistical modeling package to determine what consisted of routine activity and what was unusual activity.  

    The *Typical Trips* data set shows a statisical model of typical taxi use, taking into account weekly and yearly variations.

    The *Total Trips* data set is the actual number of taxi rides that occured.

    The *Unusual Trips* data set shows the percentage difference between ordinary behavior (the total trips) and the expected behavior (the typical trips).  A value of 0% indicates that taxi traffic was exactly the typical use for that time of the week and year, a positive value indicates that more taxis were used than normal, and a negative value that less taxis were used than normal.

Other Data
++++++++++

* **Crime**
    For each city, there is some crime indicent data.  For New York, this is stop-and-frisk data.  Many of these values are just suspected crimes.

* **Food Vendors - Boston**
    There is information on when new food vendors are licensed in Boston.

* **Mass Transit - Boston - Weekend Late-night Riders**
    This is the number of riders entering the transit system between 10 p.m. and 3 a.m. on Friday and Saturday nights (into Saturday and Sunday mornings).  This is expressed as riders per hour.
