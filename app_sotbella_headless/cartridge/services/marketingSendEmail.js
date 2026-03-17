'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');

var marketingEmailService = LocalServiceRegistry.createService('marketingcloud.sendemail', {
	createRequest: function (svc, params) {
		svc.setRequestMethod('POST');
		svc.addHeader('Content-Type', 'application/json');
		svc.addHeader('Authorization', 'Bearer ' + params.accessToken);
		return JSON.stringify(params.body);
	},
	parseResponse: function (svc, response) {
		return JSON.parse(response.text);
	},
	mockCall: function () {
		return { result: 'mocked-data-event-call', success: true };
	},
});

module.exports = {
	marketingEmailService: marketingEmailService,
};
