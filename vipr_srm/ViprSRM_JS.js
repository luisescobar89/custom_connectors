var ViPRSRM_JS = Class.create();

var SUCCESS = Packages.com.service_now.mid.probe.tpcon.OperationStatusType.SUCCESS;
var FAILURE = Packages.com.service_now.mid.probe.tpcon.OperationStatusType.FAILURE;
var Event   = Packages.com.snc.commons.eventmgmt.Event;
var SNEventSenderProvider = Packages.com.service_now.mid.probe.event.SNEventSenderProvider;
var HTTPRequest = Packages.com.glide.communications.HTTPRequest;

var VIPR_SRM = "ViPR SRM";
var MAX_EVENTS_TO_FETCH = 3000;
var errorMessage = "";

ViPRSRM_JS.prototype = Object.extendsObject(AProbe, {
	
	// test the connection with the target monitor
	testConnection : function() {
		
		ms.log("ViPRSRMJS testing connection");

		var query = this.getQueryForTestConnection(query);
		//var query = this.getQueryForExecute(query);

		ms.log("ViPRSRMJS testConnection query: " + query);
		
		var retVal = {};
		
		try {
			var response = this.getResponse(query);
			if (response == null){
				retVal['status']  = FAILURE.toString();
				retVal['error_message'] = errorMessage;
				return retVal;
			}
	
			ms.log('ViPRSRMJS Connector Testing Connection response:' + response.getBody());		 
			ms.log('result:' + response.getStatusCode());
	
			if (response.getStatusCode() === 200){
				retVal['status']  = SUCCESS.toString();
			}
			else{
				retVal['status']  = FAILURE.toString();
				this.addError('ViPRSRMJS Connector Test Connection response code: ' + response.getStatusCode());
			}
			if (retVal['status'] === FAILURE.toString())
				retVal['error_message'] = errorMessage;
			return retVal;
	
		} catch (e) {
			this.addError("Failed to connect to ViPR SRM");
			this.addError(e);
			retVal['status'] = FAILURE.toString();
			retVal['error_message'] = errorMessage;
		}
},

execute: function() {
	
	ms.log("ViPRSRMJS Connector Connector: execute connection ...");
	
	var retVal = {};
	
	var resultArray = this.getResult(this.getQueryForExecute()); //retrieve all events from the target montior
	
	var events = this.getSNEvents(resultArray); //convert raw events to SN events
	if (events == null) {
		retVal['status'] = FAILURE.toString();
		retVal['error_message'] = errorMessage;
		return retVal;
	}
	
	// send all events
	var sender = SNEventSenderProvider.getEventSender();
	var i = 0;
	var successFlag = true;
	for (; i< events.length; i++) {
		if (events[i]) {
			successFlag = successFlag && sender.sendEvent(events[i]); //send each event
		}
	}
	
	if (successFlag) {
		retVal['status'] = SUCCESS.toString();
		if (events.length > 0) {
			this.updateLastSignature(events, retVal); //if all events were sent successfuly, update last signature
		}
	} else {
		retVal['status'] = FAILURE.toString();
		retVal['error_message'] = errorMessage;
		return retVal;
	}
	
	ms.log("ViprSRMJS Connector: sent " + events.length +
	" events. Return to instance: status="+retVal['status'] +
	"  lastDiscoverySignature=" + retVal['last_event'] );
	
	return retVal;
},

updateLastSignature: function(events, retVal) {

	var timeOfEvent = this.getEventTimestampFieldName();
	// the result is sorted, but the sort order can differ. Therefore
	// the last signature is either on the first or the last event
	var firstEventSignature = events[0].getField(timeOfEvent); 
	var lastEventSignature = events[events.length-1].getField(timeOfEvent);
	
	if (parseInt(firstEventSignature) >= parseInt(lastEventSignature))
		retVal['last_event'] = firstEventSignature;
	else
		retVal['last_event'] = lastEventSignature; 

},

getEventTimestampFieldName : function () { //return the name of event timestamp field
return "timestamp";
},

getSNEvents: function(resultArray) {
	if (resultArray == null)
		return null;
	
	var events = [];

    // if no events were found, return
    if (resultArray.results.length === 0)
    	return events;
	ms.log("resultArray.results.length: " + resultArray.results.length);	

	// init all maps with additional information for events
	var viprevents = this.getEvents();
	
	// cache all requierd maps with additional information for events
	
	var latestTimestamp = this.probe.getParameter("last_event");
	var i = 0;
	for (; i<resultArray.results.length; i++) {
		
		var event = this.createSNEvent(resultArray.results[i], events); //pass also cached information if possible, for example eventTypes

		// filter out events on first pull
		if (!this.filterEvent(latestTimestamp, viprevents)) {
			events.push(event);
		}
	}
	
	return events;
},

createSNEvent : function (rawEvent, viprevents) { //get all cached information as well
	var event = Event();

	var emsName = this.probe.getParameter("connector_name");
	event.setEmsSystem(emsName);
	event.setSource(VIPR_SRM);

	if (rawEvent.EventTime != null)
	event.setTimeOfEvent(this.parseTimeOfEvent(rawEvent.EventTime)); 

	// remove not ascii chars
	var sanitizedMessage = rawEvent.fullmsg.replace(/[^\x00-\x7F]/g, " ");
	// replace \" with "
	sanitizedMessage = sanitizedMessage.replace(/\\"/g, "\"");
	event.setText(sanitizedMessage);

	var viprseverity = viprevents[rawEvent.severity];
	var viprnode = viprevents[rawEvent.device];

	//set all event fields
	event.setSeverity(viprseverity); //set severity value 1-critical to 4-warning
	event.setHostAddress(viprnode); // will be mapped to node field
	event.setField("hostname", ""); //add additional info values

return event;
},

parseTimeOfEvent: function (sourceTime) { //parse the time of event to GMT using the following format: yyyy-MM-dd HH:mm:ss

		// input is yyyy-MM-dd'T'HH:mm:ss.mmm. we are taking yyyy-MM-dd HH:mm:ss
		var timeOfEvent = sourceTime.replace('T',' ');
		timeOfEvent = timeOfEvent.substring(0,19);
		return timeOfEvent;

},

//ignore closed and info events on first action of pulling
    //ignore closed and info events on first action of pulling
    filterEvent : function (latestTimestamp, event) {
				if (latestTimestamp == null ){
					//checking if event is closed
					if( event.isClosing()){
						return true;
					}
					//checking if event is older than time period
					//time period format yyyy-MM-dd' 'HH:mm:ss.mmm
					
					var timeOfEvent = event.getTimeOfEvent().split(' ');
					var eventDate=timeOfEvent[0].split("-");
					
					var year= eventDate[0];
					var month= eventDate[1];
					var day=eventDate[2];
					//javascript month starts from 0
					var timeOfEventinMilis =new Date(year,month-1,day,0,0,0,0).getTime();
				    var initialSyncDays=this.probe.getAdditionalParameter("initial_sync_in_days");
					 
					//round to midnight
					var selectedTimePeriod=	new Date().setHours(0,0,0,0)-(initialSyncDays*24*60*60*1000);
					
					if(selectedTimePeriod>timeOfEventinMilis){
						ms.log("event with time stamp " + event.getTimeOfEvent()+" will be filtered out. It is older than "+initialSyncDays +" last days");
						return true;
					}
					
				}
				
				return false;
			},

getQueryForTestConnection : function () {
	var query = "/APG-REST/events/occurrences/values?filter=severity%3D%27%25%25%27&limit=1";
	return query;
},

getQueryForExecute : function () {
	
	var latestTimestamp = this.probe.getParameter("last_event");

	var query = "/APG-REST/events/occurrences/values?filter=active%3D%271%27" +
	"&properties=device,devtype,parttype,part,timestamp,severity,location,eventdisplayname,fullmsg,active,eventstate,eventname,acknowledged,eventtype,sourceip,partdisplayname,openedat,closedat,lastchangedat" +
	//"&start=" + latestTimestamp + //&start=2018-08-09T18:20:00&end=2018-08-09T18:25:00&limit=500
	"&limit=10";//"&limit=" + MAX_EVENTS_TO_FETCH + "\"" 

	//differ between first action of pulling and other
	if (latestTimestamp != null) {
		query = query + "&start=2018-08-10T18:20:00"; 
	} else {
		query = query + ""; //first cycle collection
	}
	
	return query;
},

getResponse: function(query) {
	//return parsed response according to the query type (such as REST or DB);
	
	// for example: return this.getResponseJSON(query);

	return this.getResponseJSON(query);
},

getURL : function (host, query) {
	//var port =  this.probe.getAdditionalParameter("port"); //retrieve all additional parameters unique to this Source

	var port =  this.probe.getAdditionalParameter("port").trim(); //retrieve all additional parameters unique to this Source
	var protocol = this.probe.getAdditionalParameter("protocol").trim();

	var url = protocol + "://" + host + ":" + port + query;
	return url;
	
},


createRequest: function(query) {
	var username =  this.probe.getParameter("username");
	var password =  this.probe.getParameter("password");
	var host =  this.probe.getParameter("host");

	var url = this.getURL(host, query);
	ms.log("ViPRSRMJS Connector: URL is " + url);
	var request = new HTTPRequest(url);
	request.setBasicAuth(username, password);
	return request;
	
	//return the suitable request. For example, use HTTP request:
	// var request = new HTTPRequest(url);
	// request.setBasicAuth(username, password);
	// return request;
},

 getResult : function (query) {
        
        var response = this.getResponse(query);

        if (response == null) {
            this.addError("ViPRSRMJS Connector: Failed to bring data. Null response");
            return null;
        }
        
        if (response.getStatusCode() != 200) {
            this.addError("ViPRSRMJS Connector Error Code: " +  response.getStatusCode());
            return null;
        }

        return this.parseToJSON(response); 

    },

//helper method - creates HTTP request and returns the response as JSON string
//get response and parse it to JSON
getResponseJSON: function(query) {
	var request = this.createRequest(query);
	request.addHeader('Accept','application/json');
	var response = request.get();
	if (response == null)
		this.addError(request.getErrorMessage());
	return response;
},



//helper method - returns the response after parsing it to JSON
parseToJSON : function (response) {
	var parser = new JSONParser();
	var resultJson =  parser.parse(response.getBody() );
	ms.log("Connector: Found " + resultJson.results.length + " records");
	return resultJson;
	
},

getEvents : function () {

	var query = this.getQueryForExecute(query);
        
	var resultJson = this.getResult(query);

	 if (resultJson == null)
		 return null;
	 
	 var resultMap = {};
	 
	 var i = 0;
	 for (; i<resultJson.results.length; i++) 
		 resultMap[resultJson.results[i].EventType] = 
				 [resultJson.results[i].severity, resultJson.results[i].active, resultJson.results[i].device, resultJson.results[i].fullmsg, resultJson.results[i].eventdisplayname, resultJson.results[i].timestamp];
		 
	 return resultMap;
 },

addError : function(message){
	if (errorMessage === "")
		errorMessage = message;
	else
		errorMessage += "\n" + message;
	ms.log(message);
},
	
type: "ViPRSRM_JS"
});

