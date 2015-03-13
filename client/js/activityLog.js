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
    var logger;

    /* Workflow codes are one of WF_OTHER, WF_DEFINE, WF_GETDATA, WF_EXPLORE,
     * WF_CREATE, WF_ENRICH, WF_TRANSFORM */
    var activitySpec = {
        button_click:    {wf: 'WF_EXPLORE', desc: 'click on a button'},
        checkbox_change: {wf: 'WF_EXPLORE', desc: 'checkbox changed'},
        date_apply:      {wf: 'WF_EXPLORE', desc: 'apply date-range selection'},
        date_cancel:     {wf: 'WF_EXPLORE', desc: 'cancel date-range picker'},
        date_hide:       {wf: 'WF_EXPLORE', desc: 'hide date-range picker'},
        date_show:       {wf: 'WF_EXPLORE', desc: 'show date-range picker'},
        input_change:    {wf: 'WF_EXPLORE', desc: 'text input field changed'},
        link_click:      {wf: 'WF_EXPLORE', desc: 'click on a link'},
        load_data:       {wf: 'WF_GETDATA', desc: 'loaded new data'},
        navigate:        {wf: 'WF_EXPLORE', desc: 'browser navigation change'},
        select_change:   {wf: 'WF_EXPLORE', desc: 'select box changed'},
        show_tooltip:    {wf: 'WF_EXPLORE', desc: 'show tooltip'},
        slide:           {wf: 'WF_EXPLORE', desc: 'move a slider'},
        slideStart:      {wf: 'WF_EXPLORE', desc: 'start moving a slider',
            name: 'slide_start'
        },
        slideStop:       {wf: 'WF_EXPLORE', desc: 'stop moving a slider',
            name: 'slide_stop'
        }
    };

    if (window.activityLogger) {
        /* jshint -W055 */
        logger = new activityLogger($('body').attr('staticRoot') +
                                    '/draper.activity_worker-2.1.1.js')
            .testing(false)
            .echo(false);
        logger.registerActivityLogger('http://parakon:9000', 'geoapp',
                                      geoapp.version);
        var origInit = geoapp.View.prototype.initialize;
        geoapp.View.prototype.initialize = function () {
            origInit.apply(this, arguments);
            geoapp.activityLog.logControls($(this.el).children(),
                                           $(this.el).children().attr('id'));
        };
        geoapp.router.on('route', function (route, params) {
            if (params.length) {
                params = params.slice(-1)[0];
            }
            geoapp.activityLog.logActivity('navigate', {
                route: route, params: params
            });
        });
    }

    geoapp.activityLog = {
        /* Log user activity with appropriate workflow information.
         *
         * @param activity: one of the activity names in the activitySpec
         *                  object.
         * @param data: an object with data to log about the activity.  For
         *              instance, the id of the control, or the coordinates of
         *              the mouse.
         */
        logActivity: function (activity, data) {
            if (!logger) {
                return;
            }
            var activityDesc = activity;
            var wf = logger.WF_OTHER;
            if (activitySpec[activity]) {
                activityDesc = activitySpec[activity].desc || activityDesc;
                wf = logger[activitySpec[activity].wf] || wf;
                if (activitySpec[activity].name) {
                    activity = activitySpec[activity].name;
                }
            }
            logger.logUserActivity(activityDesc, activity, wf, data);
        },

        /* Log system activity.
         *
         * @param activityDesc: a description of the activity.
         * @param data: an object with data to log about the activity.
         */
        logSystem: function (activityDesc, data) {
            if (!logger) {
                return;
            }
            logger.logSystemActivity(activityDesc, data);
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
                log.logSystem('show view', {view: viewName});
            }
            $('input[type="text"]:visible', selector)
            .on('change', function (evt) {
                log.logActivity('input_change', {
                    id: $(this).attr('id'),
                    value: $(this).val()
                });
            });
            $('select:visible', selector).on('change', function (evt) {
                log.logActivity('select_change', {
                    id: $(this).attr('id'),
                    value: $(this).val()
                });
            });
            $('a', selector).on('click', function (evt) {
                log.logActivity('link_click', {
                    id: $(this).attr('id'),
                    href: $(this).attr('href')
                });
            });
            $('button', selector).on('click', function (evt) {
                log.logActivity('button_click', {
                    id: $(this).attr('id')
                });
            });
            $('input[type="checkbox"]:visible', selector)
            .on('change', function (evt) {
                log.logActivity('checkbox_change', {
                    id: $(this).attr('id'),
                    value: $(this).is(':checked')
                });
            });
            $('[title]', selector).on('shown.bs.tooltip', function (evt) {
                var ctl = $(this);
                /* If we don't show a tooltip for a minimum amount of time,
                 * don't bother logging it -- the user won't have read it. */
                window.setTimeout(function () {
                    if (ctl.next('div.tooltip:visible').length) {
                        log.logActivity('show_tooltip', {
                            id: ctl.attr('id'),
                            closestId: (ctl.attr('id') ? undefined :
                                        ctl.closest('[id]').attr('id'))
                        });
                    }
                }, 500);
            });
            $('.slider', selector)
            .on('slide slideStart slideStop', function (evt) {
                log.logActivity(evt.type, {
                    id: $(this).attr('id'),
                    value: evt.value
                });
            });
            $('.ga-date-range', selector).on('apply.daterangepicker ' +
                'cancel.daterangepicker hide.daterangepicker ' +
                'show.daterangepicker', function (evt) {
                    log.logActivity('date_' + evt.type, {
                        id: $(this).attr('id'),
                        value: $(this).val()
                    });
                });
            /* Add pan and zoom support here */
        }
    };
})();
