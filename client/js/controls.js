geoapp.views.ControlsView = geoapp.View.extend({
    events: {
        'click #ga-controls-filter': function () {
            var params = {}
            $('#ga-settings [taxifield]').each(function () {
                var elem = $(this);
                var value = elem.val();
                if (value.length > 0) {
                    params[elem.attr('taxifield')] = elem.val();
                }
            });
            this.getDateRange('#ga-settings #ga-pickup-date', params,
                              'pickup_datetime');
            replaceMapData({params: params});
        }
    },

    initialize: function () {
        girder.cancelRestRequests('fetch');
        this.render();
    },
    
    render: function () {
        var ctls = this.$el.html(geoapp.templates.controls(
        )).on('ready.geoapp.view', function () {
            $('#ga-pickup-date').daterangepicker({
                timePicker: true,
                startDate: '2013-01-01 00:00',
                endDate: '2014-01-01 00:00',
                format: 'YYYY-MM-DD HH:mm',
                timePicker12Hour: false,
                timePickerIncrement: 5
            });
        });
        showMap([]);
        ctls.trigger($.Event('ready.geoapp.view', {relatedTarget: ctls}));
        return this;
    },

    /* Get a range from a date range control.  The ranges are of the form
     * YYYY-MM-DD hh:mm:ss - YYYY-MM-DD hh:mm:ss .  Everything is optional.
     * The ranges must be separated by the string ' - '.
     * @param selector: selector for input control.
     * @param params: dictionary in which to store result.
     * @param baseKey: baseKey for which to store the value.  If there is no
     *                 range separator, this is assumed to be a singular
     *                 entry.
     */
    getDateRange: function (selector, params, baseKey) {
        var val = $(selector).val().trim();
        if (val === '') {
            return;
        }
        var parts = val.split(' - ');
        if (parts.length === 1) {
            params[baseKey] = val;
            return;
        }
        if (parts[0].trim() !== '') {
            params[baseKey+'_min'] = parts[0].trim();
        }
        if (parts[1].trim() !== '') {
            params[baseKey+'_max'] = parts[1].trim();
        }
    }
});

/*
geoapp.router.route('', 'index', function () {
    geoapp.events.trigger('ga:navigateTo', geoapp.views.ControlsView);
});
*/
