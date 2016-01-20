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

geoapp.dataHandlers = {};

geoapp.DataHandler = function (arg) {
    'use strict';

    if (!(this instanceof geoapp.DataHandler)) {
        return new geoapp.DataHandler(arg);
    }
    arg = arg || {};

    var m_verbose = 0,
        m_routeSettings,
        m_routeSettingsCheck = 0,
        m_routeSettingsTime;

    /* maximumDataPoints defaults to the maximum of maximumMapPoints and
     * maximumVectors from the geoapp.map object. */
    this.maximumDataPoints = null;
    /* pageDataPoints to null to load everything in one batch (to use
     * maximumDataPoints).  If oneSmallPage is true, pageDataPoints are loaded,
     * then all of the rest of the data in a second query.  If false,
     * pageDataPoints are loaded at a time until all of the data is loaded. */
    this.pageDataPoints = 10000;
    this.oneSmallPage = true;

    /* Set or get the current verbosity for console logging.
     *
     * @param verbose: if specified, set the verbosity to this integer.
     * @returns: the current verbosity.
     */
    this.verbosity = function (verbose) {
        if (verbose !== undefined) {
            m_verbose = parseInt(verbose);
        }
        return m_verbose;
    };

    /* Setup parameters for a chain of rest calls to obtains data.  The options
     * consist of:
     *  params: a list of parameters to pass to the rest call.  If they are
     *      not set, the limit and fields keys in this dictionary are set.
     *  maxcount: unset to auto-pick values, otherwise the maximum number of
     *      points to retrieve.
     *  data: the data that has been fetched.  This is extended as more data
     *      arrives.
     *  startTime: the epoch in ms when the first call to this function was
     *      made.
     *  display: a list of parameters that affect the display but not the
     *      selected data.
     *
     * @param options: a dictionary of options to augment as needed.  Modified.
     * @param desc: short description.  Also used as a key to get some
     *              settings.
     * @param maxcount: the maximum number of rows to retreive.
     */
    this.setupRequestOptions = function (options, desc, maxcount) {
        if (!options.maxcount) {
            if (m_verbose >= 1) {
                console.log(options);
            }
            options.maxcount = maxcount;
            options.params.offset = 0;
            options.params.format = 'list';
            options.data = null;
            options.startTime = new Date().getTime();
            options.callNumber = 0;
            options.requestTime = options.showTime = 0;
            options.origMapParams = geoapp.map.getMapParams(desc);
            options.description = desc;
            if (options.params.source) {
                var info = $('#app-data ' + desc + 'data option[key="' +
                    options.params.source + '"]');
                _.each(['access', 'poll'], function (attr) {
                    options[attr] = info.attr(attr);
                });
            }
            if (!options.access) {
                options.access = desc;
            }
        }
        if (!options.params.limit) {
            options.params.limit = Math.min(
                this.pageDataPoints || options.maxcount, options.maxcount);
        } else if (this.oneSmallPage) {
            options.params.limit = options.maxcount - options.params.offset;
        }
        options.requestTime -= new Date().getTime();
        if (m_verbose >= 1) {
            console.log(desc + ' request ' + (new Date().getTime() -
                                             options.startTime));
        }
    };

    /* Process the data as it comes in from a rest end point.
     *
     * @param options: the request options.
     * @param resp: the ajax response.
     * @param showfunc: a function to show the data.  It is passed (options).
     * @param loadfunc: a function to call after the data has been processed
     *                  and shown.  It is passed (options, callNext, moreData)
     *                  where callNext is true if more data should be fetched,
     *                  and moreData is true if there is probably more data
     *                  that could be loaded.  If callNext is true, moreData is
     *                  always true.
     */
    this.processRequestData = function (options, resp, showfunc, loadfunc) {
        if (!options.data || (options.updateFromPoll &&
                options.updateFromPoll !== true)) {
            options.data = resp;
        } else if (options.updateFromPoll) {
            if (!this.mergeFromPoll(options, resp)) {
                return;
            }
        } else {
            $.merge(options.data.data, resp.data);
            options.data.datacount += resp.datacount;
            options.data.nextId = resp.nextId;
        }
        options.data.requestTime = new Date().getTime();
        options.requestTime += new Date().getTime();
        options.showTime -= new Date().getTime();
        if (m_verbose >= 1) {
            console.log(options.description + ' show ' +
                        (new Date().getTime() - options.startTime));
        }
        var currentMapParams = geoapp.map.getMapParams(options.desc);
        if (!_.isEqual(currentMapParams, options.origMapParams)) {
            options.display = currentMapParams;
        }
        var moreData = (options.data.datacount < options.data.count ||
            (resp.datacount === options.params.limit &&
            options.data.count === undefined));
        if (!moreData) {
            options.data.loadFactor = 1;
        } else if (options.data.count !== undefined) {
            options.data.loadFactor = (
                options.data.datacount / options.data.count);
        } else if (options.data.maxid && options.data.columns &&
                options.data.columns._id !== undefined) {
            options.data.loadFactor = (
                (options.data.data[options.data.datacount - 1][
                options.data.columns._id] + 1) / (options.data.maxid + 1));
        } else if (options.data.columns &&
                options.data.columns.rand1 !== undefined) {
            options.data.loadFactor = options.data.data[
                options.data.datacount - 1][options.data.columns.rand1] *
                0.000000001;
        }
        showfunc.call(this, options);
        options.callNumber += 1;
        options.showTime += new Date().getTime();
        var callNext = (moreData && options.data.datacount < options.maxcount);
        if (m_verbose >= 1) {
            console.log(
                options.description + (callNext ? ' next ' : ' last ') +
                (new Date().getTime() - options.startTime) + ' ' +
                options.data.datacount + ' ' + options.data.count +
                ' requestTime ' + options.requestTime + ' showTime ' +
                options.showTime);
        }
        if (callNext) {
            options.params.offset += resp.datacount;
        }
        loadfunc.call(this, options, callNext, moreData);
        geoapp.activityLog.logSystem('load_data', 'datahandler', {
            data: options.description,
            params: options.params,
            complete: !callNext
        });
        geoapp.events.trigger('ga:dataLoaded.' + this.datakey, options);
    };

    /* Set or clear the loading animation.
     *
     * @param mode: 'first' for first batch of data, 'second' for subsequent
     *              batches of data, 'poll' for live-polling, 'delayed' for
     *              interrupted polling, anything else to hide the animation.
     * @param elem: a jquery selector for the element containing the loading
     *              animation.  If not specified, use this.loadingElement.
     * @param hidden: true to hide the animation, false to show it.
     * @param first: true if this is the first batch of data, false if not.
     */
    this.loadingAnimation = function (mode, elem) {
        elem = $(elem || this.loadingElement);
        var hidden = ($.inArray(mode, ['first', 'second', 'poll', 'delayed']) <
                      0);
        elem.toggleClass('hidden', !!hidden);
        if (!hidden) {
            elem.toggleClass('first-load', mode === 'first');
            elem.toggleClass('second-load', mode === 'second');
            elem.toggleClass('poll-load', mode === 'poll');
            elem.toggleClass('delayed-load', mode === 'delayed');
            /* Restart the animation */
            $('i', elem).removeClass('animate-spin');
            window.setTimeout(function () {
                $('i', elem).addClass('animate-spin');
            }, 1);
        }
    };

    /* Show a message about how much data has been loaded.
     *
     * @param selector: jquery selector of are where the laoding message shou;d
     *                  be shown.
     * @param count: number of items loaded.  undefined for error.
     * @param callNext: true if more data is going to be fetched.
     * @param moreData: true if there is more data that could be loaded.
     * @param singleItem: single form of item loaded (e.g., 'trip').
     * @param pluralItem: plural form of item loaded (e.g., 'trips').
     * @param loadFactor: if moreData could be loaded and this is set, this is
     *                    the estimated amount of data that has been loaded so
     *                    far (on a scale of [0-1]).
     */
    this.loadedMessage = function (selector, count, callNext, moreData,
                                   singleItem, pluralItem, loadFactor) {
        var shortMsg, longMsg;
        if (count === undefined) {
            shortMsg = 'Error';
            longMsg = sprintf(
                'Error loading %s.  Check the network and database access.',
                pluralItem);
        } else {
            shortMsg = sprintf('%s %d', callNext ? 'Loading' : (
                moreData ? 'First' : 'All'), count);
            longMsg = sprintf('Load%s %s %d %s', callNext ? 'ing' : 'ed',
                               moreData ? 'first' : 'all', count,
                              count === 1 ? singleItem : pluralItem);
            if (moreData && loadFactor) {
                var digits = Math.max(1, Math.ceil(
                    -1 - Math.log10(loadFactor)));
                longMsg += sprintf(
                    ', about %' + (digits + 2) + '.' + digits + 'f%%',
                    loadFactor * 100);
            }
            if (!callNext && moreData) {
                longMsg += sprintf('.  Increase Max %s to load more data.',
                    pluralItem[0].toUpperCase() + pluralItem.substring(1));
            }
        }
        $(selector).text(shortMsg).attr('title', longMsg)
            .tooltip().attr('data-original-title', longMsg)
            .tooltip('fixTitle');
    };

    /* Get or set the route settings dictionary.
     *
     * @param settings: undefined to get the settings, or a dictionary to set.
     * @param always: if getting the settings and this is not truthy, return
     *                null if the settings haven't changed since we last got
     *                them.
     * @return: settings if changed or always is truthy, null if unchanged.
     */
    this.routeSettings = function (settings, always) {
        if (settings === undefined) {
            if (m_routeSettingsCheck < m_routeSettingsTime || always) {
                m_routeSettingsCheck = new Date().getTime();
                return m_routeSettings;
            }
            return null;
        }
        m_routeSettings = settings;
        m_routeSettingsTime = new Date().getTime();
        return m_routeSettings;
    };

    /* Duplicate parameters used in a query where there are nearly equivalent
     * keys.  This allows a single function to work with different data access
     * methods.
     *
     * @param options: the options block that has paraemters.  If maxocunt is
     *                 unset, then adjust the parameters.
     * @param equalKeys: a map between equivalent key names.
     */
    this.generalizeParameters = function (options, equalKeys) {
        if (!options.maxcount && equalKeys) {
            var params = options.params;
            _.each(equalKeys, function (key1, key2) {
                _.each(['', '_min', '_max', '_search'], function (suffix) {
                    if (params[key1 + suffix] === undefined &&
                            params[key2 + suffix] !== undefined) {
                        params[key1 + suffix] = params[key2 + suffix];
                    } else if (params[key2 + suffix] === undefined &&
                            params[key1 + suffix] !== undefined) {
                        params[key2 + suffix] = params[key1 + suffix];
                    }
                });
            });
        }
    };
};

/* -------- taxi data handler -------- */

geoapp.dataHandlers.taxi = function (arg) {
    'use strict';
    var m_datakey = 'taxi';

    if (!(this instanceof geoapp.dataHandlers[m_datakey])) {
        return new geoapp.dataHandlers[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.DataHandler.call(this, arg);

    this.datakey = m_datakey;
    this.loadingElement = '#ga-taxi-loading';

    /* Replace or add to the taxi data used for the current map.
     *
     * @param: options: a dictionary with the parameters to use for fetching
     *                  data and the state of the process.  See
     *                  setupRequestOptions for more details.
     */
    this.dataLoad = function (options) {
        this.setupRequestOptions(options, m_datakey, (
            options.params.max_trips || this.maximumDataPoints ||
            Math.max(geoapp.map.maximumMapPoints,
                     geoapp.map.maximumVectors)));
        if (!options.params.fields) {
            if (options.access === 'taxirandom') {
                options.params.fields = 'rand1,';
            } else {
                options.params.fields = '_id,';
            }
            options.params.fields +=
                'pickup_datetime,pickup_longitude,pickup_latitude,' +
                'dropoff_datetime,dropoff_longitude,dropoff_latitude';
        }
        geoapp.cancelRestRequests('taxidata');
        this.loadingAnimation(!options.params.offset ? 'first' : 'second');
        options.params.clientid = geoapp.clientID;
        var xhr = geoapp.restRequest({
            path: 'geoapp/taxi', type: 'GET', data: options.params
        }).done(_.bind(function (resp) {
            this.processRequestData(options, resp, this.dataShow,
                                    this.dataLoaded);
        }, this)).error(_.bind(function () {
            if (xhr.statusText !== 'abort') {
                this.loadingAnimation(null);
                this.loadedMessage('#ga-points-loaded', undefined, false, false,
                                   'trip', 'trips');
            }
        }, this));
        xhr.girder = {taxidata: true};
    };

    /* Show the taxi data after it has been fetched.
     *
     * @param options: the request options.
     */
    this.dataShow = function (options) {
        var layer = geoapp.map.getLayer(this.datakey);
        layer.data(options.data);
        layer.setCycleDateRange(
            options.params, 'pickup_datetime_min', 'pickup_datetime_max',
            m_datakey);
        geoapp.map.showMap(options.description, options.display);
    };

    /* Load more taxi data or indicated that we are finished loading.
     *
     * @param options: the request options.
     * @param callNext: true if more data is needed.
     * @param moreData: true if more data is available.
     */
    this.dataLoaded = function (options, callNext, moreData) {
        this.loadedMessage('#ga-points-loaded', options.data.datacount,
                           callNext, moreData, 'trip', 'trips',
                           options.data.loadFactor);
        if (callNext) {
            this.dataLoad(options);
        } else {
            this.loadingAnimation(null);
        }
    };
};

inherit(geoapp.dataHandlers.taxi, geoapp.DataHandler);

/* -------- instagram data handler -------- */

geoapp.dataHandlers.instagram = function (arg) {
    'use strict';
    var m_datakey = 'instagram';

    if (!(this instanceof geoapp.dataHandlers[m_datakey])) {
        return new geoapp.dataHandlers[m_datakey](arg);
    }
    arg = arg || {};
    geoapp.DataHandler.call(this, arg);

    var m_this = this,
        m_sortOrder = 'raw',
        m_sortedIndices,
        m_sortOrderList = ['raw', 'date', 'date-desc'],
        m_sortOrderIcons = ['sort', 'sort-down', 'sort-up'],
        m_lastInstagramTableInit = 0,
        m_lastInstagramTableCallNumber;

    this.datakey = m_datakey;
    this.loadingElement = '#ga-instagram-loading';
    this.equalKeys = {
        msg: 'caption',
        msg_date: 'posted_date',
        ingest_date: 'scraped_date'
    };

    geoapp.events.on('ga:dataVisibility.' + m_datakey, function (params) {
        /* This had been:
        if (params.dataDate < m_lastInstagramTableInit &&
                params.visDate >= m_lastInstagramTableInit) {
         * but sometimes the table would fail to update.  I've removed the
         * first restriction, and will see if I ever can spot the bug again.
         */
        if (params.visDate >= m_lastInstagramTableInit) {
            if (params.length) {
                m_this.instagramTableInit(true);
            } else {
                if (!$('#ga-instagram-results-panel').hasClass('hidden')) {
                    geoapp.activityLog.logSystem(
                        'inst_table_hide', 'datahandler', {});
                    $('#ga-instagram-results-panel').addClass('hidden');
                }
            }
        }
    });

    /* Replace or add to the instagram data used for the current map.
     *
     * @param: options: a dictionary with the parameters to use for fetching
     *                  data and the state of the process.  See
     *                  setupRequestOptions for more details.
     */
    this.dataLoad = function (options) {
        this.generalizeParameters(options, this.equalKeys);
        this.setupRequestOptions(options, 'instagram', (
            options.params.max_instagrams || this.maximumDataPoints ||
            geoapp.map.maximumMapPoints));
        if (!options.params.fields) {
            if (options.access === 'message') {
                options.params.fields = 'rand1,rand2,' +
                    'msg_date,msg,url,image_url,latitude,longitude,user_name';
            } else {
                options.params.fields = '_id,' +
                    'posted_date,caption,url,image_url,latitude,longitude';
            }
        }
        if (this.restartPollTimer) {
            /* Cancel a poll-restart timer */
            window.clearTimeout(this.restartPollTimer);
            delete this.restartPollTimer;
        }
        geoapp.cancelRestRequests('instagramdata');
        if (!options.updateFromPoll) {
            this.loadingAnimation(!options.params.offset ? 'first' : 'second');
        } else {
            this.loadingAnimation(
                options.updateFromPoll === true ? 'poll' : 'delayed');
        }
        options.params.clientid = geoapp.clientID;
        var xhr = geoapp.restRequest({
            path: 'geoapp/' + options.access, type: 'GET', data: options.params
        }).done(_.bind(function (resp) {
            _.each(m_this.equalKeys, function (key1, key2) {
                if (resp.columns[key1] === undefined) {
                    resp.columns[key1] = resp.columns[key2];
                }
                if (resp.columns[key2] === undefined) {
                    resp.columns[key2] = resp.columns[key1];
                }
            });
            if (resp.nextId && !options.params._id_max &&
                    !options.updateFromPoll) {
                options.params._id_max = resp.nextId;
            }
            this.processRequestData(options, resp, this.dataShow,
                                    this.dataLoaded);
        }, this)).error(_.bind(function () {
            if (xhr.statusText !== 'abort') {
                if (!options.updateFromPoll) {
                    this.loadingAnimation(null);
                    this.loadedMessage('#ga-inst-points-loaded', undefined,
                                       false, false, 'message', 'messages');
                } else {
                    /* If polling and we had an error, try to restart it. */
                    this.pollRestart(options);
                }
            }
        }, this));
        xhr.girder = {instagramdata: true};
    };

    /* Show the instagram data after it has been fetched.
     *
     * @param options: the request options.
     */
    this.dataShow = function (options) {
        m_lastInstagramTableCallNumber = options.callNumber;
        var layer = geoapp.map.getLayer(this.datakey);
        layer.data(options.data);
        layer.setCycleDateRange(
            options.params, 'posted_date_min', 'posted_date_max', m_datakey);
        options.display.callNumber = options.callNumber;
        geoapp.map.showMap(options.description, options.display);
        /* Hide the instagram results panel if there is no data.  Show it with
         * a small quantity of data if there is data. */
        if (!options.data || !options.data.data || !options.data.data.length) {
            if (!$('#ga-instagram-results-panel').hasClass('hidden')) {
                geoapp.activityLog.logSystem(
                    'inst_table_hide', 'datahandler', {});
                $('#ga-instagram-results-panel').addClass('hidden');
            }
            return;
        }
        var table = $('#ga-instagram-results-table');
        table.attr('count', options.data.data.length);
    };

    /* Load more instagram data or indicated that we are finished loading.
     *
     * @param options: the request options.
     * @param callNext: true if more data is needed.
     * @param moreData: true if more data is available.
     */
    this.dataLoaded = function (options, callNext, moreData) {
        this.loadedMessage('#ga-inst-points-loaded', options.data.datacount,
                           callNext, moreData, 'message', 'messages',
                           options.data.loadFactor);
        if (callNext) {
            this.dataLoad(options);
        } else if (options.poll && parseFloat(options.poll) > 0) {
            this.pollMoreData(options, moreData);
        } else {
            this.loadingAnimation(null);
        }
    };

    /* Poll for more and changing data.
     *
     * @param options: the request options.
     * @param moreData: true if more data is available.
     */
    this.pollMoreData = function (options, moreData) {
        if (!options.maxcount || !options.data || !options.data.nextId ||
                !options.data.columns ||
                options.data.columns.rand1 === undefined) {
            return;
        }
        options.params.limit = options.maxcount;
        options.params._id_min = options.data.nextId;
        options.params.offset = 0;
        delete options.params._id_max;
        if (moreData) {
            options.params.rand1_max = options.data.data[
                options.data.data.length - 1][options.data.columns.rand1] + 1;
        }
        options.params.poll = parseFloat(options.poll);
        /* We might want this to be configurable, since the initwait is the
         * fastest update rate when data is coming in constantly. */
        options.params.initwait = options.params.poll * 0.1;
        /* We can make this a longer value, but it ties up cherrypy making it
         * exhaust resources if too many queries are made. */
        options.params.wait = 60;
        options.updateFromPoll = true;
        this.dataLoad(options);
    };

    /* If we had an error polling for more data, wait successively longer and
     * longer times.  Each time try to requery the whole data.  Just reupdating
     * won't always work (for instance, if the server bounced and was
     * maintaining state).
     *
     * @param options: the request options. */
    this.pollRestart = function (options) {
        this.loadingAnimation('delayed');
        if (options.updateFromPoll === true) {
            options.updateFromPoll = Math.max(parseFloat(options.poll), 10);
        } else {
            options.updateFromPoll = Math.ceil(Math.min(
                options.updateFromPoll * 1.25, 900));
        }
        // wait the determined time, then requery
        delete options.params._id_min;
        delete options.params.poll;
        delete options.params.initwait;
        delete options.params.wait;
        console.log('Failed to poll database.  Waiting ' +
            options.updateFromPoll + ' seconds and trying again.');
        this.restartPollTimer = window.setTimeout(function () {
            m_this.dataLoad(options);
        }, options.updateFromPoll * 1000);
    };

    /* Merge data from a polling cycle into the main data.  This adjusts the
     * response to look like a general response and the options.data to
     * include the new results.
     *
     * @param options: the request options.
     * @param resp: the ajax response.
     * @param newdata: true if there is new data.
     */
    this.mergeFromPoll = function (options, resp) {
        /* Set the new _id_min so we don't requery more than we have to. */
        options.params._id_min = options.data.nextId = resp.nextId;
        /* If we didn't get any new data, keep polling */
        if (!resp.datacount) {
            this.pollMoreData(
                options, options.data.data.length >= options.maxcount);
            return false;
        }
        /* Otherwise, merge the new data into the old, sort it by the random
         * index, and delete any excess. */
        $.merge(options.data.data, resp.data);
        options.data.datacount += resp.datacount;
        var col1 = options.data.columns.rand1,
            col2 = options.data.columns.rand2;
        options.data.data.sort(function (a, b) {
            if (a[col1] !== b[col1]) {
                return parseInt(b[col1]) < parseInt(a[col1]) ? 1 : -1;
            }
            return parseInt(b[col2]) < parseInt(a[col2]) ? 1 : -1;
        });
        if (options.data.data.length > options.maxcount) {
            options.data.data = options.data.data.slice(0, options.maxcount);
            options.data.datacount = options.data.data.length;
        }
        resp.datacount = options.data.datacount;
        return true;
    };

    /* Initialize the results table, clearing any old results.
     *
     * @param always: if true, always initialize the table.  If false, only
     *                do so if the table is currently shown.
     */
    this.instagramTableInit = function (always) {
        if (!always && $('#ga-instagram-results-panel').hasClass('hidden')) {
            return;
        }
        var oldScroll, oldRows;
        if (m_lastInstagramTableCallNumber) {
            oldScroll = $('#ga-instagram-results .results-table').scrollTop();
            if (oldScroll) {
                var rows = $('#ga-instagram-results-table tr[item]');
                oldRows = rows.length;
                var parentRect = $('#ga-instagram-results-table').closest(
                    '.al-scroller')[0].getBoundingClientRect();
                for (var row = 0; row < oldRows; row += 100) {
                    if (rows[row].getBoundingClientRect().top >
                            parentRect.bottom) {
                        oldRows = row;
                        break;
                    }
                }
            }
        }
        m_lastInstagramTableInit = new Date().getTime();
        m_sortedIndices = null;
        var settings = this.routeSettings();
        if (settings && settings['instagram-table-sort']) {
            if ($.inArray(settings['instagram-table-sort'],
                          m_sortOrderList) >= 0) {
                m_sortOrder = settings['instagram-table-sort'];
            }
        }
        var icon = $('#ga-instagram-results-sort i');
        for (var i = 0; i < m_sortOrderIcons.length; i += 1) {
            icon.toggleClass('icon-' + m_sortOrderIcons[i],
                             m_sortOrder === m_sortOrderList[i]);
        }
        $('#ga-instagram-results-panel').removeClass('hidden');
        $('#ga-instagram-results-table tr:has(td)').remove();
        $('#ga-instagram-results .results-table').scrollTop(0);
        if (this.instagramTable(oldRows, oldScroll)) {
            geoapp.infiniteScroll('#ga-instagram-results .results-table',
                                  this.instagramTable, this);
        }
    };

    /* Append rows to the instagram table.
     *
     * @param oldRows: if defined, make sure at least this many rows are shown.
     * @param oldScroll: if defined, scroll to this point after adding rows.
     * @return: true if there is more data. */
    this.instagramTable = function (oldRows, oldScroll) {
        var table = $('#ga-instagram-results-table'),
            page = Math.max(100, oldRows || 0),
            layer = geoapp.map.getLayer(this.datakey),
            data = layer.data(true),
            moreData = false;
        if (!data || !data.data || !data.data.length) {
            return moreData;
        }
        var current = $('tr[item]', table).length,
            date_column = data.columns.posted_date,
            caption_column = data.columns.caption,
            url_column = data.columns.url,
            dataIndices = [],
            i, item;
        $('.ga-more-results', table).remove();
        switch (m_sortOrder) {
            case 'date': case 'date-desc':
                if (!m_sortedIndices) {
                    m_sortedIndices = [];
                    for (i = 0; i < data.data.length; i += 1) {
                        m_sortedIndices.push(i);
                    }
                    m_sortedIndices.sort(function (a, b) {
                        a = data.data[a];
                        b = data.data[b];
                        if (a[date_column] !== b[date_column]) {
                            return a[date_column] - b[date_column];
                        }
                        return b[caption_column] < a[caption_column] ? 1 : -1;
                    });
                    if (m_sortOrder === 'date-desc') {
                        m_sortedIndices.reverse();
                    }
                }
                dataIndices = m_sortedIndices.slice(current, current + page);
                break;
            default:
                if (data.sortedIndices) {
                    dataIndices = data.sortedIndices.slice(current,
                                                           current + page);
                } else {
                    for (i = current; i < data.data.length && i < current + page;
                            i += 1) {
                        dataIndices.push(i);
                    }
                }
                break;
        }
        /* We may want to apply another filter to the data here */
        for (i = 0; i < dataIndices.length; i += 1) {
            item = data.data[dataIndices[i]];
            table.append($('<tr/>')
                .attr({
                    item: dataIndices[i],
                    url: item[url_column]
                })
                .append($('<td/>').text(moment(item[date_column])
                    .utcOffset(0).format('MMM D HH:mm')))
                .append($('<td/>').text(item[caption_column]))
                /* Don't add a tooltip, since we pop up the photo elsewhere */
            );
        }
        geoapp.activityLog.logSystem(
            !current ? 'inst_table' : 'inst_table_add', 'datahandler', {});
        if (current + page < data.data.length) {
            moreData = true;
            table.append($('<tr/>').attr({
                class: 'ga-more-results'
            }).append($('<td/>').attr({
                colspan: 2
            }).text('More ...')));
        }
        /* If hovering over a row, show the relevant instagram point */
        $('tr', table).off('.instagram-table'
        ).on('mouseleave.instagram-table', function () {
            if (!layer.persistentCurrentPoint()) {
                layer.currentPoint(null);
            }
        }).on('click.instagram-table mouseenter.instagram-table',
            this.instagramTableHighlight
        );
        if (oldScroll) {
            $('#ga-instagram-results .results-table').scrollTop(oldScroll);
        }
        return moreData;
    };

    /* Highlight the hovered over row.
     *
     * @param evt: the event that triggered this call.
     */
    this.instagramTableHighlight = function (evt) {
        var layer = geoapp.map.getLayer(m_this.datakey),
            idx = $(evt.currentTarget).attr('item'),
            isClick = evt.type === 'click';
        if (idx === '' || idx === undefined) {
            idx = null;
        }
        if (isClick) {
            layer.persistentCurrentPoint(idx, 'table');
        } else {
            if (layer.persistentCurrentPoint()) {
                return;
            }
        }
        layer.currentPoint(idx, isClick, isClick, 'table');
    };

    /* Get, set, or toggle the sort of the main table between unsorted, date
     * ascending, and date descending.
     *
     * @param newOrder: undefined to get the current sort order.  'toggle' to
     *                  cycle through the various options.  Otherwise, one of
     *                  m_sortOrderList[].
     */
    this.sortOrder = function (newOrder) {
        if (newOrder === undefined) {
            return m_sortOrder;
        }
        if ($.inArray(newOrder, m_sortOrderList) < 0) {
            /* If the specified value isn't in our list, cycle through the
             * valid values. */
            newOrder = m_sortOrderList[($.inArray(
                m_sortOrder, m_sortOrderList) + 1) % m_sortOrderList.length];
        }
        if (newOrder !== m_sortOrder) {
            m_sortOrder = newOrder;
            geoapp.updateNavigation(
                undefined, 'results', {'instagram-table-sort': m_sortOrder},
                true);
            m_this.instagramTableInit();
        }
        return m_sortOrder;
    };
};

inherit(geoapp.dataHandlers.instagram, geoapp.DataHandler);

/* -------- generic data handler -------- */

geoapp.addDataHandler = function (datainfo) {
    geoapp.dataHandlers[datainfo.key] = function (arg) {
        'use strict';
        var m_datakey = datainfo.key;
        var m_date = datainfo.datekey || 'date';

        if (!(this instanceof geoapp.dataHandlers[m_datakey])) {
            return new geoapp.dataHandlers[m_datakey](arg);
        }
        arg = arg || {};
        geoapp.DataHandler.call(this, arg);

        this.datakey = m_datakey;
        this.loadingElement = '#ga-' + m_datakey + '-loading';

        /* Replace or add to the data used for the current map.
         *
         * @param: options: a dictionary with the parameters to use for fetching
         *                  data and the state of the process.  See
         *                  setupRequestOptions for more details.
         */
        this.dataLoad = function (options) {
            this.setupRequestOptions(options, m_datakey, (
                options.params['max_field_' + m_datakey] ||
                this.maximumDataPoints ||
                Math.max(geoapp.map.maximumMapPoints,
                         geoapp.map.maximumVectors)));
            if (!options.params.fields) {
                options.params.fields = (datainfo.fields ||
                    'date,latitude,longitude');
            }
            $.each(options.params, function (key, val) {
                if (key.startsWith(m_datakey + '_field_')) {
                    options.params[key.substr(
                        (m_datakey + '_field_').length)] = val;
                }
            });
            geoapp.cancelRestRequests(m_datakey + 'data');
            this.loadingAnimation(!options.params.offset ? 'first' : 'second');
            options.params.clientid = geoapp.clientID;
            var xhr = geoapp.restRequest({
                path: 'geoapp/' + m_datakey, type: 'GET', data: options.params
            }).done(_.bind(function (resp) {
                this.processRequestData(options, resp, this.dataShow,
                                        this.dataLoaded);
            }, this)).error(_.bind(function () {
                if (xhr.statusText !== 'abort') {
                    this.loadingAnimation(null);
                    this.loadedMessage(
                        '#ga-' + m_datakey + '-loaded', undefined, false,
                        false, datainfo.name, datainfo.names);
                }
            }, this));
            xhr.girder = {};
            xhr.girder[m_datakey + 'data'] = true;
        };

        /* Show the data after it has been fetched.
         *
         * @param options: the request options.
         */
        this.dataShow = function (options) {
            var layer = geoapp.map.getLayer(this.datakey);
            layer.data(options.data);
            layer.setCycleDateRange(
                options.params, m_date + '_min', m_date + '_max',
                m_datakey);
            geoapp.map.showMap(options.description, options.display);
        };

        /* Load more data or indicated that we are finished loading.
         *
         * @param options: the request options.
         * @param callNext: true if more data is needed.
         * @param moreData: true if more data is available.
         */
        this.dataLoaded = function (options, callNext, moreData) {
            this.loadedMessage(
                '#ga-' + m_datakey + '-loaded', options.data.datacount,
                callNext, moreData, datainfo.name, datainfo.names,
                options.data.loadFactor);
            if (callNext) {
                this.dataLoad(options);
            } else {
                this.loadingAnimation(null);
            }
        };
    };

    inherit(geoapp.dataHandlers[datainfo.key], geoapp.DataHandler);
};
