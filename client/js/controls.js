function replaceMapData(options) {
    if (!options.maxcount) {
        options.maxcount = 250000;
        options.params.offset = 0;
        options.data = null;
        options.startTime = (new Date).getTime();
    }
    if (!options.params.limit) {
        options.params.limit = 25000;
    }
    if (!options.params.fields) {
        options.params.fields = 'medallion, hack_license, pickup_datetime, pickup_longitude, pickup_latitude';
    }
    console.log('request '+((new Date).getTime()-options.startTime)); //DWM::
    geoapp.cancelRestRequests('mapdata');
    var xhr = geoapp.restRequest({
        path: 'taxi', type: 'GET', data: options.params
    }).done(_.bind(function (resp) {
        if (!options.data) {
            options.data = resp;
        } else {
            $.merge(options.data.data, resp.data);
            options.data.datacount += resp.datacount;
        }
        console.log('show '+((new Date).getTime()-options.startTime)); //DWM::
        showMap(options.data.data);
        if (options.data.datacount < options.data.count &&
                options.data.datacount < options.maxcount) {
            options.params.offset += resp.datacount;
            console.log('next '+((new Date).getTime()-options.startTime)+' '+options.params.offset); //DWM::
            replaceMapData(options);
        } else {
            console.log('last '+((new Date).getTime()-options.startTime)+' '+options.params.offset); //DWM::
        }
    }, this));
    xhr.girder = {mapdata: true};
}    

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
            replaceMapData({
                params: params
            });
        }
    },

    initialize: function () {
        girder.cancelRestRequests('fetch');
        this.render();
    },
    
    render: function () {
        this.$el.html(geoapp.templates.controls());
        showMap([]);
        return this;
    }
});

/*
geoapp.router.route('', 'index', function () {
    geoapp.events.trigger('ga:navigateTo', geoapp.views.ControlsView);
});
*/
