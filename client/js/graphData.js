/* Copyright 2015 Kitware Inc.
 *
 *  Licensed under the Apache License, Version 2.0 ( the "License" );
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

geoapp.graphData = {};

/* -------- base data class -------- */

geoapp.GraphData = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.GraphData)) {
        return new geoapp.GraphData(arg);
    }
    arg = arg || {};

    var m_updateTime = 0;

    this.dataItems = {};

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        return datakey ? false : [];
    };

    /* Based on a datakey, provide a description of the data.  name and
     * description keys are required.  There are optional keys:
     *  data: reserved for internal data buffering.
     *  dataTime: reserved for internal data buffering.
     *  sort: 0-based preferred sort order, lower sorts first.
     *  unit: unit to display after a value if exactly one.  Defaults to units.
     *  units: units to display after a value, if any.
     *
     * @param datakey: the data that is should be described.
     * @returns: a dictionary with at least 'name' and 'description' key values
     *           describing the specified data.
     */
    this.describe = function (datakey) {
        return this.dataItems[datakey];
    };

    /* Get the date range for the specific datakey.
     *
     * @param datakey: the data for which the date range is returned.
     * @param opts: options that may affect the date range returned.
     * @returns: the start (inclusive) and end (exclusive) date range for the
     *           data.
     */
    this.dateRange = function (datakey, opts) {
        var data = this.data(datakey, opts);
        return {
            start: 0 + moment.utc(data[0].x).startOf('day'),
            end: 0 + moment.utc(data[data.length - 1].x).subtract(
                1, 'ms').endOf('day').add(1, 'ms')
        };
    };

    /* Mark the data as updated, or return the last update time.
     *
     * @param update: if true, update the time to the current time.  If a
     *                number, set the time to the specified millisecond epoch,
     *                if undefined, just return the update time.
     * @return updateTime: the update time for the data.
     */
    this.dataTime = function (update) {
        if (update === true) {
            update = new Date().getTime();
        }
        if (update !== undefined) {
            m_updateTime = update;
        }
        return m_updateTime;
    };

    /* Given a start and end epoch and a text duration, generate bins where
     * each bin has a x value corresponding to its start epoch and a y value
     * of 0.
     *
     * @param start: the start epoch.
     * @param end: the end epoch.
     * @param duration: the text name of the duration of each bin (e.g.,
     *                  'hour', 'day', 'week', 'month'.
     * @returns: an object with the start and end forced to the exact start and
     *           end of a day or the duration, whichever is longer (possibly
     *           increasing the specified range), the created bins, and the
     *           duration interval in milliseconds (which won't make sense for
     *           the 'month' duration).
     */
    this.makeDateBins = function (start, end, duration) {
        var interval = 0 + moment.duration(1, moment.normalizeUnits(duration)),
            bins = [],
            i;
        start = 0 + moment.utc(start).startOf('day').startOf(duration);
        end = 0 + moment.utc(end).subtract(1, 'ms').endOf('day').endOf(
            'duration').add(1, 'ms');
        for (i = start; i < end; i = 0 + moment.utc(i).add(
                1, duration).startOf(duration)) {
            bins.push({x: i, y: 0});
        }
        return {start: start, end: end, bins: bins, interval: interval};
    };
};


geoapp.GraphDataFromColumns = function (arg, datakey) {
    'use strict';
    var m_datakey = datakey;

    if (!(this instanceof geoapp.GraphDataFromColumns)) {
        return new geoapp.GraphDataFromColumns(arg, datakey);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    geoapp.events.on('ga:dataLoaded.' + m_datakey, function () {
        this.dataTime(true);
        geoapp.graph.updateGraphDelayed();
    }, this);

    /* Given a datakey, return the associated data from an appropriate column.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey, opts) {
        var binName = 'data' + (opts.bin !== 'day' ? '-' + opts.bin : ''),
            data = geoapp.map.getLayer(m_datakey).data();
        if (this.dataItems[datakey][binName] && this.dataItems[datakey][
                binName + 'Time'] >= data.requestTime) {
            return this.dataItems[datakey][binName];
        }
        var dateRange = this.dateRange(datakey, opts),
            datecol = data.columns[this.dataItems[datakey].column],
            res = this.makeDateBins(dateRange.start, dateRange.end, opts.bin),

            start = res.start,
            end = res.end,
            bins = res.bins,
            interval = res.interval,
            numBins = bins.length;
        _.each(data.data, function (item) {
            var bin;
            if (opts.bin !== 'month') {
                bin = parseInt((item[datecol] - start) / interval);
            } else {
                if (item[datecol] < start) {
                    bin = -1;
                } else if (item[datecol] >= end) {
                    bin = numBins;
                } else {
                    for (bin = 0; bin < bins.length - 1; bin += 1) {
                        if (item[datecol] < bins[bin + 1].x) {
                            break;
                        }
                    }
                }
            }
            if (bin >= 0 && bin < numBins) {
                bins[bin].y += 1;
            }
        });
        if (this.dataItems[datakey].scaled) {
            /* Scale based on partial data and convert to log2 */
            if (data.loadFactor && data.loadFactor !== 1) {
                _.each(bins, function (d) {
                    d.y = parseInt(d.y / data.loadFactor);
                });
            }
            var log2 = Math.log(2);
            _.each(bins, function (d) {
                d.y = d.y ? Math.log(d.y) / log2 : 0;
            });
        }
        this.dataItems[datakey][binName] = bins;
        this.dataItems[datakey][binName + 'Time'] = new Date().getTime();
        return this.dataItems[datakey][binName];
    };

    /* Get the date range for the specific datakey.
     *
     * @param datakey: the data for which the date range is returned.
     * @param opts: options that may affect the date range returned.
     * @returns: the start (inclusive) and end (exclusive) date range for the
     *           data.
     */
    this.dateRange = function () {
        var layer = geoapp.map.getLayer(m_datakey),
            dateRange = layer.cycleDateRange();
        return {
            start: 0 + (dateRange.start || moment.utc('2013-1-1')),
            end: 0 + (dateRange.end || moment.utc('2014-1-1'))
        };
    };
};

inherit(geoapp.GraphDataFromColumns, geoapp.GraphData);

/* -------- internal graph data -------- */

geoapp.graphData.internal = function (arg) {
    'use strict';
    var m_datakey = 'internal';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    this.dataItems = {
        fullrange: {
            name: '',
            description: 'Full date range for all data'
        }
    };

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @param forUser: true if this is to show the user, falsy for internal
     *                 use.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey, forUser) {
        var avail = forUser ? [] : _.keys(this.dataItems);
        return datakey ? ($.inArray(datakey, avail) >= 0) : avail;
    };

    /* Given a datakey, return the associated data.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function () {
        var range = geoapp.map.getCycleDateRange();
        return [{x: 0 + range.start, y: 0}, {x: 0 + range.end, y: 0}];
    };
};

inherit(geoapp.graphData.internal, geoapp.GraphData);
geoapp.graphData.internal = geoapp.graphData.internal();

/* -------- weather graph data -------- */

geoapp.graphData.weather = function (arg) {
    'use strict';
    var m_datakey = 'weather';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    this.dataItems = {
        temp_mean: {
            name: 'Avg. Temp',
            description: 'Mean temperature in degrees F',
            sort: 1,
            units: '&deg;F'
        },
        cloudcover: {
            name: 'Cloud Cover',
            description: 'Cloud cover value',
            exclude: true
        },
        fog: {
            name: 'Fog',
            description: 'Fog occurred',
            events: 'fog',
            collate: 'add'
        },
        precipitation: {
            name: 'Precipitation',
            description: 'Precipitation in inches',
            units: 'in',
            collate: 'add'
        },
        rain: {
            name: 'Rain',
            description: 'Rain occurred',
            events: 'rain',
            collate: 'add'
        },
        snow: {
            name: 'Snow',
            description: 'Snow occurred',
            events: 'snow',
            collate: 'add'
        },
        wind_gust: {
            name: 'Wind Gust',
            description: 'Gust speed in mph',
            units: 'mph',
            collate: 'max'
        },
        wind_max: {
            name: 'Wind Max',
            description: 'Max wind speed in mph',
            units: 'mph',
            collate: 'max'
        },
        wind_mean: {
            name: 'Wind',
            description: 'Mean wind speed in mph',
            units: 'mph'
        }
    };

    geoapp.events.on('ga:staticDataLoaded.' + m_datakey, function () {
        this.dataTime(true);
        geoapp.graph.updateGraphDelayed();
    }, this);

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.staticData ? geoapp.staticData[m_datakey] : null;
        if (!data || !data.columns || !data.data) {
            return datakey ? false : [];
        }
        var avail = [];
        _.each(this.dataItems, function (item, key) {
            if (!item.exclude && (item.events ||
                   data.columns[key] !== undefined)) {
                avail.push(key);
            }
        });
        return datakey ? ($.inArray(datakey, avail) >= 0) : avail;
    };

    /* Given a datakey, return the associated data.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey, opts) {
        var binName = 'data' + (opts.bin !== 'day' ? '-' + opts.bin : ''),
            xcol, ycol, results = [],
            dataItem = this.dataItems[datakey];
        if (!dataItem.data) {
            var data = geoapp.staticData[m_datakey];
            xcol = data.columns.date_start;
            if (dataItem.events) {
                ycol = data.columns.events;
                _.each(data.data, function (d) {
                    results.push({
                        x: d[xcol],
                        y: d[ycol].toLowerCase().indexOf(
                            dataItem.events) >= 0 ? 1 : 0
                    });
                });
            } else {
                ycol = data.columns[datakey];
                _.each(data.data, function (d) {
                    results.push({x: d[xcol], y: d[ycol]});
                });
            }
            dataItem.data = results;
            dataItem.dataTime = new Date().getTime();
            dataItem.dataHourly = null;
        }
        if (opts.bin === 'day') {
            return dataItem.data;
        }
        if (!dataItem[binName]) {
            results = [];
            if (opts.bin === 'hour') {
                _.each(dataItem.data, function (d) {
                    for (var i = 0; i < 24; i += 1) {
                        results.push({x: d.x + i * 3600 * 1000, y: d.y});
                    }
                });
            } else {  /* week and month */
                var res = this.makeDateBins(dataItem.data[0].x, dataItem.data[dataItem.data.length - 1].x, opts.bin),
                    start = res.start,
                    end = res.end,
                    bins = res.bins,
                    interval = res.interval;
                _.each(dataItem.data, function (item) {
                    var bin;
                    if (item.x < start || item.x >= end) {
                        return;
                    }
                    if (opts.bin !== 'month') {
                        bin = parseInt((item.x - start) / interval);
                    } else {
                        for (bin = 0; bin < bins.length - 1; bin += 1) {
                            if (item.x < bins[bin + 1].x) {
                                break;
                            }
                        }
                    }
                    if (dataItem.collate === 'max') {
                        bins[bin].y = Math.max(bins[bin].y, item.y);
                    } else {
                        bins[bin].y += item.y;
                        bins[bin].count = (bins[bin].count || 0) + 1;
                    }
                });
                if (!dataItem.collate) {
                    _.each(bins, function (d) {
                        if (d.count) {
                            d.y /= d.count;
                        }
                    });
                }
                results = bins;
            }
            dataItem[binName] = results;
            dataItem[binName + 'Time'] = new Date().getTime();
        }
        return dataItem[binName];
    };

    /* Get the date range for the specific datakey.
     *
     * @param datakey: the data for which the date range is returned.
     * @param opts: options that may affect the date range returned.
     * @returns: the start (inclusive) and end (exclusive) date range for the
     *           data.
     */
    this.dateRange = function (datakey, opts) {
        var data = this.data(datakey, $.extend({}, opts, {bin: 'day'}));
        return {
            start: 0 + moment.utc(data[0].x).startOf('day'),
            end: 0 + moment.utc(data[data.length - 1].x).subtract(
                1, 'ms').endOf('day').add(1, 'ms')
        };
    };
};

inherit(geoapp.graphData.weather, geoapp.GraphData);
geoapp.graphData.weather = geoapp.graphData.weather();

/* -------- taxi model graph data -------- */

geoapp.graphData.taximodel = function (arg) {
    'use strict';
    var m_datakey = 'taximodel';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphData.call(this, arg);

    this.dataItems = {
        model: {
            name: 'Taxi - Typical Trips',
            description: 'Expected number of taxi trips under ordinary conditions (the seasonal and trend components of the modeled data)',
            units: 'log2(trips)'
        },
        remainder: {
            name: 'Taxi - Unusual Trips',
            description: 'Taxi trips that aren\'t part of regular behavior (the remainder component of the modeled data)',
            units: '&Delta;log2(trips)',
            column: 'remainder'
        },
        total: {
            name: 'Taxi - Total Trips',
            description: 'All taxi trips for the entire city (the raw component of the model)',
            units: 'log2(trips)',
            column: 'raw'
        }
    };

    geoapp.events.on('ga:staticDataLoaded.' + m_datakey, function () {
        this.dataTime(true);
        geoapp.graph.updateGraphDelayed();
    }, this);

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.staticData ? geoapp.staticData[m_datakey] : null;
        if (!data) {
            return datakey ? false : [];
        }
        var avail = _.keys(this.dataItems);
        return datakey ? ($.inArray(datakey, avail) >= 0) : avail;
    };

    /* Given a datakey, return the associated data.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.data = function (datakey, opts) {
        if (opts.bin !== 'hour') {
            return this.dataGrouped(datakey, opts);
        }
        if (!this.dataItems[datakey].data) {
            var data = geoapp.staticData[m_datakey],
                xcol = data.columns.date,
                ycol,
                results = [];
            if (this.dataItems[datakey].column) {
                ycol = data.columns[this.dataItems[datakey].column];
            }
            _.each(data.data, function (d) {
                var item = { x: d[xcol] * 1000 },
                    value;
                if (!d[data.columns.raw]) {
                    return;
                }
                switch (datakey) {
                    case 'model':
                        value = (d[data.columns.seasonal] +
                            d[data.columns.trend]);
                        break;
                    default:
                        value = d[ycol];
                        break;
                }
                item.y = value; //Math.pow(2, value);
                results.push(item);
            });
            this.dataItems[datakey].data = results;
            this.dataItems[datakey].dataTime = new Date().getTime();
        }
        return this.dataItems[datakey].data;
    };

    /* Given a datakey, return the associated data collected to time interval
     * values.
     *
     * @param datakey: the datakey to retreive.
     * @param opts: options that may affect the date range returned.
     * @return data: an array of data.  Each item contains 'x', the millisecond
     *               epoch, and 'y', the data value.
     */
    this.dataGrouped = function (datakey, opts) {
        var binName = 'data-' + opts.bin,
            dataItem = this.dataItems[datakey];
        if (!dataItem[binName]) {
            var data = geoapp.staticData[m_datakey],
                xcol = data.columns.date,
                ycol,
                lastitem,
                results = [];
            if (dataItem.column) {
                ycol = data.columns[dataItem.column];
            }
            _.each(data.data, function (d) {
                var item = {
                        x: 0 + moment.utc(d[xcol] * 1000).startOf(opts.bin)
                    },
                    value;
                if (!d[data.columns.raw]) {
                    return;
                }
                switch (datakey) {
                    case 'model':
                        value = (d[data.columns.seasonal] +
                            d[data.columns.trend]);
                        break;
                    default:
                        value = d[ycol];
                        break;
                }
                item.y = value;
                if (lastitem && item.x === lastitem.x) {
                    lastitem.count += 1;
                    lastitem.tally += (datakey === 'remainder' ? item.y :
                        Math.pow(2, item.y));
                    if (lastitem.tally) {
                        lastitem.y = (datakey === 'remainder' ?
                            lastitem.tally / lastitem.count :
                            Math.log(lastitem.tally) / Math.log(2)).toFixed(4);
                    }
                } else {
                    results.push(item);
                    lastitem = item;
                    lastitem.count = 1;
                    lastitem.tally = (datakey === 'remainder' ? item.y :
                        Math.pow(2, item.y));
                }
            });
            dataItem[binName] = results;
            dataItem[binName + 'Time'] = new Date().getTime();
        }
        return dataItem[binName];
    };

    /* Get the date range for the specific datakey.
     *
     * @param datakey: the data for which the date range is returned.
     * @param opts: options that may affect the date range returned.
     * @returns: the start (inclusive) and end (exclusive) date range for the
     *           data.
     */
    this.dateRange = function (datakey, opts) {
        var data = this.data(datakey, $.extend({}, opts, {bin: 'hour'}));
        return {
            start: 0 + moment.utc(data[0].x).startOf('day'),
            end: 0 + moment.utc(data[data.length - 1].x).subtract(
                1, 'ms').endOf('day').add(1, 'ms')
        };
    };
};

inherit(geoapp.graphData.taximodel, geoapp.GraphData);
geoapp.graphData.taximodel = geoapp.graphData.taximodel();

/* -------- taxi graph data -------- */

geoapp.graphData.taxi = function (arg) {
    'use strict';
    var m_datakey = 'taxi';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphDataFromColumns.call(this, arg, m_datakey);

    this.dataItems = {
        pickups: {
            name: 'Taxi Pickups',
            description: 'Filtered taxi pickups',
            column: 'pickup_datetime',
            unit: 'trip',
            units: 'trips'
        },
        dropoffs: {
            name: 'Taxi Dropoffs',
            description: 'Filtered taxi dropoffs',
            column: 'dropoff_datetime',
            unit: 'trip',
            units: 'trips'
        },
        scaledpickups: {
            name: 'Taxi Scaled Pickups',
            description: 'Filtered taxi pickups scaled to full data range',
            column: 'pickup_datetime',
            scaled: true,
            unit: 'trip',
            units: 'trips'
        },
        scaleddropoffs: {
            name: 'Taxi Scaled Dropoffs',
            description: 'Filtered taxi dropoffs scaled to full data range',
            column: 'dropoff_datetime',
            scaled: true,
            unit: 'trip',
            units: 'trips'
        }
    };

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.map.getLayer(m_datakey).data();
        if (!data || !data.columns || !data.data) {
            return datakey ? false : [];
        }
        return (datakey ? (this.dataItems[datakey] !== undefined) :
            _.keys(this.dataItems));
    };
};

inherit(geoapp.graphData.taxi, geoapp.GraphDataFromColumns);
geoapp.graphData.taxi = geoapp.graphData.taxi();

/* -------- instagram graph data -------- */

geoapp.graphData.instagram = function (arg) {
    'use strict';
    var m_datakey = 'instagram';

    if (!(this instanceof geoapp.graphData[m_datakey])) {
        return new geoapp.graphData[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.GraphDataFromColumns.call(this, arg, m_datakey);

    this.dataItems = {
        messages: {
            name: 'Messages',
            description: 'Number of Instagram / Twitter messages',
            column: 'posted_date',
            sort: 0,
            unit: 'msg',
            units: 'msgs'
        }
    };

    /* List what data, if any, is available to be graphed.
     *
     * @param datakey: if present, check if this datakey is available.
     * @returns: a list of available data keys if datakey is undefined, or a
     *           boolean indicating if the specified datakey is available.
     */
    this.available = function (datakey) {
        var data = geoapp.map.getLayer(m_datakey).data();
        if (!data || !data.columns || !data.data) {
            return datakey ? false : [];
        }
        return (datakey ? (this.dataItems[datakey] !== undefined) :
            _.keys(this.dataItems));
    };
};

inherit(geoapp.graphData.instagram, geoapp.GraphDataFromColumns);
geoapp.graphData.instagram = geoapp.graphData.instagram();
