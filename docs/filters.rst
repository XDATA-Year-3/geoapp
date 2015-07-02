Selecting Data (Filtering)
--------------------------

.. image:: filters.jpg
    :align: right

Data is selected in the **Filters** panel.

Region and Date
+++++++++++++++

The **Region** control restricts results to a specific city or selects data
from all regions.  After changing this, you need to select **Filter** for both
the trip and message data to reload it with the changed region.

The **Date** can be specified to limit which trips and messages re loaded.  The date range is *inclusive* of the start and *exclusive* of the end.  For instance, to load the first day of May, specify from 2013-05-01 00:00 - 2013-05-02 00:00.  Times are 24 hour format.

Taxi and Bike Share Data
++++++++++++++++++++++++

If you select the upper **Filter** button, taxi and bike share trip information is loaded from the database.  By default, a limited sample of data is loaded, distributed across the entire year of 2013.

The **Max Trips** slider can be used to load more data, which will result in more accurate graphs and binned data, but take longer and use more local resources.

Trip data is plotted on the map using black points for each trip, or shown using blue and yellow points, lines, or squares, depending on the display settings.

Trips can be selected based on **Trip Distance** and number of **Passengers**.  Not all data sets have this information (for instance, it isn't set in the Bike Share data).


.. _filterMessages:

Twitter and Instagram Data
++++++++++++++++++++++++++

The lower **Filter** button loads Instagram and Twitter messages from the database.

The **Max Inst.** slider can be used to load more data, which will take longer and use more local resources.

A **Text Search** can be used to get only messages related to a particular topic.  This uses a general text search, so a value of 'Hospital' will match both 'Hospital' and 'Hospitality'.  If multiple words are specified, all words are required.  Words can be prefixed with a minus sign to exclude them, and can be quoted to match an exact form.  For instance, 'Hospital -"Hospitality"' will find hospitals but exclude posts about hotel conferences.

You can use the | character to perform OR searches, ! or - excludes a serach term.  Parentheses ( ) can be used to group terms for more complicated searches.

Instagram and Twitter data is plotted on the map using red points.
