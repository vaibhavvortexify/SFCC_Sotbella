'use strict';

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');

var marketingEmailRegistration = LocalServiceRegistry.createService('marketingcloud.emailreg', {
	createRequest: function (svc, params) {
		svc.setRequestMethod('PUT');
		svc.addHeader('Content-Type', 'application/json');
		svc.addHeader('Authorization', 'Bearer ' + params.token);

		if (params.email) {
			var baseURL = svc.configuration.credential.URL;
			svc.setURL(baseURL + '/EmailAddress:' + encodeURIComponent(params.email));
		}

		var body = {
			values: {
				EmailAddress: params.email,
				MobileNumber: params.phoneNumber,
				Email_OptIn: true,
				SMS_OptIn: false,
				Whatsapp_OptIn: false,
				Site_ID: params.siteId
			},
		};

		return JSON.stringify(body);
	},
	parseResponse: function (svc, response) {
		return JSON.parse(response.text);
	},
	mockCall: function () {
		return { result: 'mocked-data-event-call', success: true };
	},
});

module.exports = {
	marketingEmailRegistration: marketingEmailRegistration,
};
