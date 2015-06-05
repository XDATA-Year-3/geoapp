Selecting Data (Filtering)
--------------------------

.. image:: filters.jpg
    :align: right

Data is selected in the **Filters** panel.

Taxi Data
+++++++++

If you select the upper **Filter** button, taxi trip information is loaded from the database.  By default, a limited sample of data is loaded, distributed across the entire year of 2013.

The **Max Trips** slider can be used to load more data, which will result in more accurate graphs and binned data, but take longer and use more local resources.

The **Pickup Date** can be specified to limit which trips are loaded.  Remember that the data is only for 2013, so if you specify a date outside of that range, you won't get any results.  The date range is *inclusive* of the start and *exclusive* of the end.  For instance, to load the day of May, specify from 2013-05-01 00:00 - 2013-05-02 00:00.  Times are 24 hour format.

Taxi data is plotted on the map using black points for each trip, or shown using blue and yellow points, lines, or squares, depending on the display settings.

.. _filterMessages:

Instagram and Twitter Data
++++++++++++++++++++++++++

The lower **Filter** button loads Instagram and Twitter messages from the database.  If **Use Pickup Date Range** is selected, the Pickup Date from the Taxi area will be used.  If it is not selected, the dates can be limited by specifying a range in the **Posted Date** field.

The **Max Inst.** slider can be used to load more data, which will take longer and use more local resources.

A **Caption Search** can be used to get only messages related to a particular topic.  This uses a general text search, so a value of 'Hospital' will match both 'Hospital' and 'Hospitality'.  If multiple words are specified, all words are required.  Words can be prefixed with a minus sign to exclude them, and can be quoted to match an exact form.  For instance, 'Hospital -"Hospitality"' will find hospitals but exclude posts about hotel conferences.

Instagram and Twitter data is plotted on the map using red points.
