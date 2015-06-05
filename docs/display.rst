Displaying Data
---------------

.. image:: display.jpg
    :align: right

Background Map
++++++++++++++

The base map can be changed using the **Map Source** option in the **Display** panel.  It can be made more or less visible with the **Opacity** slider next to the Map Source Option.

A specific area of the map can be centered by selecting one of the location buttons (**Manhattan**, **Midtown**, or **Times Sq.**).

The map can be panned and zoomed with the mouse.

Taxi Data
+++++++++

The taxi data contains pickup and dropoff locations and times for each trip.  If **Processing** is set to 'Individual Trips', each trip that was filtered will be shown as a single dot.  If the **Display Type** is 'Pickup Locations', the points are drawn in black and show where taxis picked up fares.  'Dropoff Locations' show black points where the fares were discharged.  'Pickup - Dropoff Locations' show pickups in *blue* and dropoffs in *yellow*.

The **Max Points** control determine how much is drawn on the map.  You can load more points with the filtering options than your machine might display easily.  The **Opacity** control determines how dark each point appears.

If **Display Type** is 'Pickup - Dropoff Vectors' a straight line connects each pickup location with the corresponding dropoff location.  The line is blue at the pickup end and yellow at the dropoff end.

If **Processing** is set to 'Binned Heatmap', all of the filtered taxi trips are used to produce a a grid of squares whose opacity is proportional to whichever square had the most taxi trips.  If the **Display Type** is 'Pickup - Dropoff Locations', the squares are blue when there are more pickups than dropoffs, and yellow when there are more dropoffs than pickups.  The number of bins across the map can be changed and the map can be rebinned as desired.

Instagram and Twitter Data
++++++++++++++++++++++++++

Instagram and Twitter data is always shown as red points.  The **Max Points** and **Opacity** controls affect how it is displayed.
