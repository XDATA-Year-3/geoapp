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

/* This file optionally utilizes the Draper logging functionality if the
 * appropriate javscript files are available.  If not, it functionally does
 * nothing.
 */

(function () {
    var logger,
        uri = $('body').attr('activityLogURI'),
        logMeta = ($('body').attr('activityLogMeta') !== 'false'),
        logLimit = {
            frequency: 1000 /* in milliseconds */
        };

    /* elements: BUTTON CANVAS CHECKBOX COMBOBOX DATAGRID DIALOG_BOX
     *  DROPDOWNLIST FRAME ICON INFOBAR LABEL LINK LISTBOX LISTITEM MAP MENU
     *  MODALWINDOW PALETTEWINDOW PANEL PROGRESSBAR RADIOBUTTON SLIDER SPINNER
     *  STATUSBAR TAB TABLE TAG TEXTBOX THROBBER TOAST TOOLBAR TOOLTIP TREEVIEW
     *  WINDOW WORKSPACE OTHER
     * activities: ADD REMOVE CREATE DELETE SELECT DESELECT ENTER LEAVE INSPECT
     *  ALTER HIDE SHOW OPEN CLOSE PERFORM
     */
    var activitySpec = {
        anim_action:     {elem: 'window',   act: 'alter',
            desc: 'animation action', value: 'action'},
        button_click:    {elem: 'button',   act: 'select',
            desc: 'click on a button'},
        c3_brush:        {elem: 'panel',    act: 'inspect',
            desc: 'select a time span on the subchart', name: 'graph_select'},
        c3_zoomend:      {elem: 'panel',    act: 'inspect',
            desc: 'zoom in on the graph', name: 'graph_zoom'},
        c3_zoomstart:    {elem: 'panel',    act: 'inspect',
            desc: 'start zooming on the graph', name: 'graph_zoomstart'},
        calendar_click:  {elem: 'datagrid', act: 'select',
            desc: 'click on a calendar element'},
        checkbox_change: {elem: 'checkbox', act: 'alter',
            desc: 'checkbox changed'},
        date_apply:      {elem: 'panel',    act: 'alter',
            desc: 'apply date-range selection'},
        date_cancel:     {elem: 'panel',    act: 'lease',
            desc: 'cancel date-range picker'},
        date_hide:       {elem: 'panel',    act: 'hide',
            desc: 'hide date-range picker'},
        date_show:       {elem: 'panel',    act: 'show',
            desc: 'show date-range picker'},
        drag_sortable:   {elem: 'listbox',  act: 'alter',
            desc: 'drag and reposition sortable item'},
        graph_tooltip:   {elem: 'tooltip',  act: 'show',
            desc: 'show graph tooltip'},
        hide_overlay:    {elem: 'map',      act: 'hide',
            desc: 'hide overlay'},
        input_change:    {elem: 'textbox',  act: 'alter',
            desc: 'text input field changed'},
        inst_table:      {elem: 'listbox',  act: 'show',
            desc: 'show instagram table'},
        inst_table_add:  {elem: 'listbox',  act: 'alter',
            desc: 'add data to instagram table'},
        inst_table_hide: {elem: 'listbox',  act: 'hide',
            desc: 'hide instagram table'},
        link_click:      {elem: 'link',     act: 'select',
            desc: 'click on a link'},
        load_data:       {elem: 'map',      act: 'perform',
            desc: 'loaded new data'},
        map_moved:       {elem: 'map',      act: 'alter',
            desc: 'map pan, zoom, or resize'},
        navigate:        {elem: 'link',     act: 'select',
            desc: 'browser navigation change'},
        pin_overlay:     {elem: 'map',      act: 'alter',
            desc: 'persist overlay'},
        radio_click:     {elem: 'radiobutton', act: 'select',
            desc: 'radiobutton selected'},
        select_change:   {elem: 'dropdownlist', act: 'alter',
            desc: 'select box changed'},
        select_close:    {elem: 'dropdownlist', act: 'hide',
            desc: 'select box list unfocused'},
        select_open:     {elem: 'dropdownlist', act: 'show',
            desc: 'select box list focused'},
        show_overlay:    {elem: 'map',      act: 'show',
            desc: 'show overlay'},
        show_tooltip:    {elem: 'tooltip',  act: 'show',
            desc: 'show tooltip'},
        show_view:       {elem: 'window',   act: 'show',
            desc: 'show view'},
        scroll:          {elem: 'panel',    act: 'alter',
            desc: 'scroll a region'},
        slide:           {elem: 'slider',   act: 'alter',
            desc: 'move a slider'},
        slideStart:      {elem: 'slider',   act: 'enter', name: 'slide_start',
            desc: 'start moving a slider'},
        slideStop:       {elem: 'slider',   act: 'leave', name: 'slide_stop',
            desc: 'stop moving a slider'},
        start_app:       {elem: 'window',   act: 'open',
            desc: 'starting application'}
    };

    geoapp.activityLog = {
        /* Log user activity with appropriate workflow information.
         *
         * @param activity: one of the activity names in the activitySpec
         *                  object.
         * @param group: element group to log.  Alternately, if this is a
         *               jquery element, extract the element group, subelement,
         *               and element id from the jquery element.
         * @param data: an object with data to log about the activity.  For
         *              instance, the id of the control, or the coordinates of
         *              the mouse.
         * @param subElement: a string to pass as the elementSub.
         * @param system: true if system.
         * @param limit: if not falsy, rate limit activity of this sort.  If
         *               the most recent call to logActivity has the same
         *               activity, group, and this limit value, then no more
         *               than one log message of this sort is recorded per
         *               logLimit.frequency milliseconds.
         */
        logActivity: function (activity, group, data, subElement, system,
                               limit) {
            if (!logger) {
                return;
            }
            var elem;
            if (!(group instanceof String)) {
                elem = $(group);
                group = (elem.closest('[loggroup]').attr('loggroup') ||
                         'control');
            }
            if (this.limitActivity(activity, group, limit)) {
                return;
            }
            data = data || {};
            var msg = {
                activity: activity,
                action: activity,
                elementType: 'element_type',
                elementSub: subElement || '',
                elementGroup: group,
                source: system ? 'system' : 'user',
                meta: {
                    data: logMeta ? data : undefined
                },
                tags: [
                    /* a list of tags to help define some other meaningful
                     * words, such as if this action deals with a 'query' or is
                     * altering 'visual' elements */
                ]
            };

            if (!system) {
                msg.elementId = data.id;
            }
            if (activitySpec[activity]) {
                if (activitySpec[activity].desc) {
                    msg.meta.desc = activitySpec[activity].desc;
                }
                if (activitySpec[activity].name) {
                    msg.action = activitySpec[activity].name;
                }
                if (activitySpec[activity].elem) {
                    msg.elementType = activitySpec[activity].elem;
                }
                if (activitySpec[activity].act) {
                    msg.activity = activitySpec[activity].act;
                }
                if (activitySpec[activity].value) {
                    msg.elementSub = data[activitySpec[activity].value];
                }
            } else {
                console.log(['Unknown activity', activity, data]);
            }
            if (elem) {
                msg.elementSub = (elem.closest('[logsub]').attr('logsub') ||
                                  msg.elementSub);
                /* The type must be from the limited list */
                msg.elementType = (elem.closest('[logtype]').attr('logtype') ||
                                   msg.elementType);
                if (!system) {
                    var oldid = msg.elementId;
                    msg.elementId = (elem.closest('[logid]').attr('logid') ||
                                     msg.elementId);
                    if (!msg.elementSub && oldid && oldid !== msg.elementId) {
                        msg.elementSub = oldid;
                    }
                    if (!msg.elementSub) {
                        var altid = this.getControlId(elem, true);
                        if (altid && altid !== msg.elementId) {
                            msg.elementSub = altid;
                        }
                    }
                }
            }
            try {
                logger.log(msg);
            } catch (ex) {
                console.log('Activity logger caught a ' + ex.name +
                            ' exception:', ex.message, ex.stack, ex);
            }
        },

        /* Log system activity.
         *
         * @param activityDesc: a description of the activity.
         * @param group: element group to log.
         * @param data: an object with data to log about the activity.
         * @param subElement: a strign to pass as the elementSub.
         * @param limit: if not falsy, rate limit activity of this sort.  If
         *               the most recent call to logActivity has the same
         *               activity, group, and this limit value, then no more
         *               than one log message of this sort is recorded per
         *               logLimit.frequency milliseconds.
         */
        logSystem: function (activityDesc, group, data, subElement, limit) {
            if (!logger) {
                return;
            }
            this.logActivity(activityDesc, group, data, subElement, true,
                             limit);
        },

        /* Log user activity with appropriate workflow information.
         *
         * @param activity: the activity name.
         * @param group: element group to log.
         * @param limit: if not falsy, rate limit activity of this sort.  If
         *               the most recent call to logActivity has the same
         *               activity, group, and this limit value, then no more
         *               than one log message of this sort is recorded per
         *               logLimit.frequency milliseconds.
         * @return: true if this log message should be skipped.
         */
        limitActivity: function (activity, group, limit) {
            if (limit && activity === logLimit.activity &&
                    group === logLimit.group &&
                    _.isEqual(limit, logLimit.limit) && logLimit.timer) {
                return true;
            }
            if (logLimit.timer) {
                window.clearTimeout(logLimit.timer);
                logLimit.timer = null;
            }
            if (limit) {
                logLimit.activity = activity;
                logLimit.group = group;
                logLimit.limit = limit;
                logLimit.timer = window.setTimeout(function () {
                    logLimit.timer = null;
                }, logLimit.frequency);
            }
            return false;
        },

        /* Set up logging for all standard controls on the page.
         *
         * @param selector: optional jquery selector to limit the scope of the
         *                  logging.
         * @param viewName: if specified, log that we instrumented this for
         *                  logging.
         */
        logControls: function (selector, viewName) {
            if (!logger) {
                return;
            }
            var log = this,
                parent = $(selector);
            if (viewName) {
                log.logSystem('show_view', 'main', {view: viewName});
            }
            parent.on('change', 'input[type="text"]:visible', function () {
                var ctl = $(this);
                log.logActivity('input_change', ctl, {
                    id: log.getControlId(ctl),
                    value: ctl.val()
                });
            });
            parent.on('change', 'select:visible', function () {
                var ctl = $(this);
                log.logActivity('select_change', ctl, {
                    id: log.getControlId(ctl),
                    value: ctl.val()
                });
            }).on('focus', 'select:visible', function () {
                var ctl = $(this);
                if (!ctl.hasClass('hasFocus')) {
                    ctl.addClass('hasFocus');
                    log.logActivity('select_open', ctl, {
                        id: log.getControlId(ctl)
                    });
                }
            }).on('blur', 'select:visible', function () {
                var ctl = $(this);
                if (ctl.hasClass('hasFocus')) {
                    ctl.removeClass('hasFocus');
                    log.logActivity('select_close', ctl, {
                        id: log.getControlId(ctl)
                    });
                }
            });
            parent.on('click', 'a', function () {
                var ctl = $(this);
                if (ctl.attr('href')) {
                    log.logActivity('link_click', ctl, {
                        id: log.getControlId(ctl),
                        closestId: (ctl.attr('id') ? undefined :
                                    ctl.closest('[id]').attr('id')),
                        href: ctl.attr('href'),
                        value: ctl.attr('href')
                    });
                } else {
                    log.logActivity('button_click', ctl, {
                        id: log.getControlId(ctl),
                        closestId: (ctl.attr('id') ? undefined :
                                    ctl.closest('[id]').attr('id')),
                        classes: ctl.attr('class')
                    });
                }
            });
            parent.on('click', 'button,.log-as-button', function () {
                var ctl = $(this);
                log.logActivity('button_click', ctl, {
                    id: log.getControlId(ctl),
                    closestId: (ctl.attr('id') ? undefined :
                                ctl.closest('[id]').attr('id')),
                    classes: ctl.attr('class')
                });
            });
            parent.on('change', 'input[type="checkbox"]:visible', function () {
                var ctl = $(this);
                log.logActivity('checkbox_change', ctl, {
                    id: log.getControlId(ctl),
                    value: ctl.is(':checked')
                });
            });
            parent.on('click', 'input[type="radio"]', function () {
                var ctl = $(this);
                log.logActivity('radio_click', ctl, {
                    id: log.getControlId(ctl) || ctl.attr('name'),
                    closestId: (ctl.attr('id') ? undefined :
                                ctl.closest('[id]').attr('id')),
                    value: ctl.attr(ctl.attr('name')) || ctl.is(':checked')
                });
            });
            parent.on('slide slideStart slideStop', '.slider', function (evt) {
                var ctl = $(this);
                log.logActivity(evt.type, ctl, {
                    id: log.getControlId(ctl),
                    value: evt.value
                });
            });
            parent.on('apply.daterangepicker cancel.daterangepicker ' +
                'hide.daterangepicker show.daterangepicker', '.ga-date-range',
                function (evt) {
                var ctl = $(this);
                log.logActivity('date_' + evt.type, ctl, {
                    id: ctl.attr('id'),
                    value: ctl.val()
                });
            });
            parent.on('scroll', '.al-scroller', function () {
                /* log scrolling with a maximum rate and some delay.  This will
                 * show where the scrolling ended up and prevent swamping the
                 * log system with scroll events. */
                var ctl = $(this),
                    id = ctl.closest('[id]').attr('id');
                if (!log.scrollerTimers) {
                    log.scrollerTimers = {};
                }
                if (!log.scrollerTimers[id]) {
                    log.scrollerTimers[id] = window.setTimeout(function () {
                        log.scrollerTimers[id] = null;
                        log.logActivity('scroll', ctl, {
                            id: id,
                            value: ctl.scrollTop() || ctl.scrollLeft()
                        });
                    }, 333);
                }
            });
            parent.on('sort', '.g-sort-parent', function (evt) {
                var ctl = $(evt.originalEvent.item);
                log.logActivity('drag_sortable', ctl, {
                    id: ctl.attr('datakey') || log.getControlId(ctl),
                    value: evt.originalEvent.newIndex,
                    newIndex: evt.originalEvent.newIndex,
                    oldIndex: evt.originalEvent.oldIndex,
                    closestId: (ctl.attr('id') ? undefined :
                                ctl.closest('[id]').attr('id')),
                    classes: ctl.attr('class')
                });
            });
            parent.on('c3_zoomstart c3_zoomend c3_brush', '.c3',
                    function (evt, range) {
                var ctl = $(this);
                log.logActivity(evt.type, ctl, {
                    id: ctl.closest('[id]').attr('id'),
                    range: range
                });
            });
            parent.on('c3_tooltip', '.c3',
                    function (evt, elem, title) {
                var ctl = $(elem),
                    id = ctl.closest('[id]').attr('id');
                log.logActivity('graph_tooltip', ctl, {
                    id: id,
                    title: title
                }, undefined, undefined, {id: id});
            });
        },

        /* Set up logging for global controls anywhere in the document.  This
         * clears the existing logging and readds it.
         */
        logGlobalControls: function () {
            if (!logger) {
                return;
            }
            var log = this,
                doc = $(document);

            doc.off('.activityLog');
            doc.on('shown.bs.tooltip.activityLog', '[title]',
                    function (evt) {
                var ctl = $(evt.target);
                /* If we don't show a tooltip for a minimum amount of time,
                 * don't bother logging it -- the user won't have read it. */
                window.setTimeout(function () {
                    if (ctl.next('.tooltip.in').length ||
                            $('body>.tooltip.in').length) {
                        log.logActivity('show_tooltip', ctl, {
                            id: ctl.closest('[id]').attr('id')
                        });
                    }
                }, 500);
            });

            $('.daterangepicker *').off('.activityLog');
            $('.daterangepicker input[type="text"]:visible')
            .on('change.activityLog', function () {
                var ctl = $(this);
                log.logActivity('input_change', ctl, {
                    id: ctl.attr('name'),
                    value: ctl.val()
                });
            });
            $('.daterangepicker button').on('click.activityLog', function () {
                var ctl = $(this);
                log.logActivity('button_click', ctl, {
                    id: ctl.text().toLowerCase(),
                    classes: ctl.attr('class')
                });
            });
            $('.daterangepicker .available')
            .on('click.activityLog', function () {
                var ctl = $(this);
                log.logActivity('calendar_click', ctl, {
                    id: ctl.attr('data-title'),
                    side: ctl.closest('.calendar').attr('class'),
                    classes: ctl.attr('class')
                });
                window.setTimeout(_.bind(log.logGlobalControls, log), 1);
            });
            $('.daterangepicker select').on('change.activityLog', function () {
                var ctl = $(this);
                log.logActivity('select_change', ctl, {
                    id: log.getControlId(ctl),
                    value: ctl.val()
                });
                window.setTimeout(_.bind(log.logGlobalControls, log), 1);
            }).on('focus.activityLog', function () {
                var ctl = $(this);
                if (!ctl.hasClass('hasFocus')) {
                    ctl.addClass('hasFocus');
                    log.logActivity('select_open', ctl, {
                        id: log.getControlId(ctl)
                    });
                }
            }).on('blur.activityLog', function () {
                var ctl = $(this);
                if (ctl.hasClass('hasFocus')) {
                    ctl.removeClass('hasFocus');
                    log.logActivity('select_close', ctl, {
                        id: log.getControlId(ctl)
                    });
                }
            });
        },

        getControlId: function (ctl, all) {
            ctl = $(ctl);
            var id = ctl.attr('id'),
                classes = ctl.attr('class');
            if (!id && classes) {
                classes = classes.split(' ');
                for (var i = 0; i < classes.length; i += 1) {
                    if (classes[i].substr(0, 3) === 'ga-' || all) {
                        if (id) {
                            return undefined;
                        }
                        id = '.' + classes[i];
                    }
                }
            }
            return id;
        }
    };

    if (window.userale && uri) {
        /* jshint -W055 */
        logger = new userale({
            loggingUrl: uri,
            toolName: $('body').attr('activitylogname') || 'minerva',
            toolVersion: geoapp.version,
            elementGroups: [
                'main',
                'map',
                'datahandler',
                'controls'
            ],
            workerUrl: $('body').attr('staticRoot') + '/userale-worker.js',
            debug: false,
            sendLogs: true
        });
        logger.register();
        var origRender = geoapp.View.prototype.render;
        geoapp.View.prototype.render = function () {
            origRender.apply(this, arguments);
            if (!this.activityLogOn) {
                geoapp.activityLog.logControls(
                    $(this.el), this.viewName || $(this.el).attr('id'));
                geoapp.activityLog.logGlobalControls();
                this.activityLogOn = true;
            }
        };
        geoapp.router.on('route', function (route, params) {
            if (params.length) {
                params = params.slice(-1)[0];
            }
            geoapp.activityLog.logActivity('navigate', 'main', {
                route: route, params: params
            });
        });
        geoapp.activityLog.logSystem('start_app', 'main', {
            userAgent: navigator.userAgent,
            browserData: {
                screenSize: {width: screen.width, height: screen.height},
                windowSize: {
                    width: $(window).width(),
                    height: $(window).height()
                }
            }
        });
    }
})();
