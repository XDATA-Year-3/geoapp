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
        logMeta = ($('body').attr('activityLogMeta') !== 'false');

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
         * @param group: element group to log.
         * @param data: an object with data to log about the activity.  For
         *              instance, the id of the control, or the coordinates of
         *              the mouse.
         * @param subElement: a strign to pass as the elementSub.
         * @param system: true if system.
         */
        logActivity: function (activity, group, data, subElement, system) {
            if (!logger) {
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
         */
        logSystem: function (activityDesc, group, data, subElement) {
            if (!logger) {
                return;
            }
            this.logActivity(activityDesc, group, data, subElement, true);
        },

        /* Set up logging for all standard controls on the page.
         *
         * @param selector: optional jquery selector to limit the scope of the
         *                  logging.
         * @param viewName: if specified, log that we instrumented this for
         *                  logging. */
        logControls: function (selector, viewName) {
            if (!logger) {
                return;
            }
            var log = this;
            if (viewName) {
                log.logSystem('show_view', 'main', {view: viewName});
            }
            $('input[type="text"]:visible', selector)
            .on('change', function () {
                log.logActivity('input_change', 'controls', {
                    id: $(this).attr('id'),
                    value: $(this).val()
                });
            });
            $('select:visible', selector).on('change', function () {
                log.logActivity('select_change', 'controls', {
                    id: $(this).attr('id'),
                    value: $(this).val()
                });
            }).on('focus', function () {
                var ctl = $(this);
                if (!ctl.hasClass('hasFocus')) {
                    ctl.addClass('hasFocus');
                    log.logActivity('select_open', 'controls', {
                        id: ctl.attr('id')
                    });
                }
            }).on('blur', function () {
                var ctl = $(this);
                if (ctl.hasClass('hasFocus')) {
                    ctl.removeClass('hasFocus');
                    log.logActivity('select_close', 'controls', {
                        id: ctl.attr('id')
                    });
                }
            });
            $('a', selector).on('click', function () {
                var ctl = $(this);
                log.logActivity('link_click', 'controls', {
                    id: ctl.attr('id'),
                    closestId: (ctl.attr('id') ? undefined :
                                ctl.closest('[id]').attr('id')),
                    href: $(this).attr('href'),
                    value: $(this).attr('href')
                });
            });
            $('button,.log-as-button', selector).on('click', function () {
                var ctl = $(this);
                log.logActivity('button_click', 'controls', {
                    id: ctl.attr('id'),
                    closestId: (ctl.attr('id') ? undefined :
                                ctl.closest('[id]').attr('id')),
                    classes: ctl.attr('class')
                });
            });
            $('input[type="checkbox"]:visible', selector)
            .on('change', function () {
                log.logActivity('checkbox_change', 'controls', {
                    id: $(this).attr('id'),
                    value: $(this).is(':checked')
                });
            });
            $('.slider', selector)
            .on('slide slideStart slideStop', function (evt) {
                log.logActivity(evt.type, 'controls', {
                    id: $(this).attr('id'),
                    value: evt.value
                });
            });
            $('.ga-date-range', selector).on('apply.daterangepicker ' +
                'cancel.daterangepicker hide.daterangepicker ' +
                'show.daterangepicker', function (evt) {
                    log.logActivity('date_' + evt.type, 'controls', {
                        id: $(this).attr('id'),
                        value: $(this).val()
                    });
                });
            $('.al-scroller', selector)
            .on('scroll', function () {
                /* log scrolling with a maximum rate and some delay.  This will
                 * show where the scrolling ended up and prevent swamping the
                 * log system with scroll events. */
                var elem = $(this),
                    id = elem.closest('[id]').attr('id');
                if (!log.scrollerTimers) {
                    log.scrollerTimers = {};
                }
                if (!log.scrollerTimers[id]) {
                    log.scrollerTimers[id] = window.setTimeout(function () {
                        log.scrollerTimers[id] = null;
                        log.logActivity('scroll', 'controls', {
                            id: id,
                            value: elem.scrollTop() || elem.scrollLeft()
                        });
                    }, 333);
                }
            });
        },

        /* Set up logging for global controls anywhere in the document.  This
         * clears the existing logging and readds it.
         */
        logGlobalControls: function () {
            if (!logger) {
                return;
            }
            var log = this;

            $('[title]').off('shown.bs.tooltip')
            .on('shown.bs.tooltip', function (evt) {
                var ctl = $(evt.target);
                /* If we don't show a tooltip for a minimum amount of time,
                 * don't bother logging it -- the user won't have read it. */
                window.setTimeout(function () {
                    if (ctl.next('.tooltip.in').length ||
                            $('body>.tooltip.in').length) {
                        log.logActivity('show_tooltip', 'controls', {
                            id: ctl.closest('[id]').attr('id')
                        });
                    }
                }, 500);
            });

            $('.daterangepicker *').off('.activityLog');
            $('.daterangepicker input[type="text"]:visible')
            .on('change.activityLog', function () {
                log.logActivity('input_change', 'controls', {
                    id: $(this).attr('name'),
                    value: $(this).val()
                });
            });
            $('.daterangepicker button').on('click.activityLog', function () {
                var ctl = $(this);
                log.logActivity('button_click', 'controls', {
                    id: ctl.text().toLowerCase(),
                    classes: ctl.attr('class')
                });
            });
            $('.daterangepicker .available')
            .on('click.activityLog', function () {
                var ctl = $(this);
                log.logActivity('calendar_click', 'controls', {
                    id: ctl.attr('data-title'),
                    side: ctl.closest('.calendar').attr('class'),
                    classes: ctl.attr('class')
                });
                window.setTimeout(_.bind(log.logGlobalControls, log), 1);
            });
            $('.daterangepicker select').on('change.activityLog', function () {
                log.logActivity('select_change', 'controls', {
                    id: $(this).attr('id'),
                    value: $(this).val()
                });
                window.setTimeout(_.bind(log.logGlobalControls, log), 1);
            }).on('focus.activityLog', function () {
                var ctl = $(this);
                if (!ctl.hasClass('hasFocus')) {
                    ctl.addClass('hasFocus');
                    log.logActivity('select_open', 'controls', {
                        id: ctl.attr('id')
                    });
                }
            }).on('blur.activityLog', function () {
                var ctl = $(this);
                if (ctl.hasClass('hasFocus')) {
                    ctl.removeClass('hasFocus');
                    log.logActivity('select_close', 'controls', {
                        id: ctl.attr('id')
                    });
                }
            });
        }
    };

    if (window.userale && uri) {
        /* jshint -W055 */
        logger = new userale({
            loggingUrl: uri,
            toolName: 'geoapp',
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
        var origInit = geoapp.View.prototype.initialize;
        geoapp.View.prototype.initialize = function () {
            origInit.apply(this, arguments);
            geoapp.activityLog.logControls($(this.el).children(),
                                           $(this.el).children().attr('id'));
            geoapp.activityLog.logGlobalControls();
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
