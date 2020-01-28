

class ResponseMgr {

  constructor() {

  }

  send(req, res, error, data, message) {
    
    let dataTxt = (data==null)? '' : JSON.stringify(data);
    if (req && req.path) {
      if (!error) {
        console.log(req.path + ' | OK | TIME: ' + new Date(Date.now()).toLocaleString() + ' | MESSAGE: ' + message + ' | INPUT: ' + JSON.stringify(req.body) + ' | OUTPUT: ' + dataTxt);
      }
      else {
        console.error(req.path + ' | ERROR | TIME: ' + new Date(Date.now()).toLocaleString() + ' | MESSAGE: ' + message + ' | INPUT: ' + JSON.stringify(req.body) + ' | OUTPUT: ' + dataTxt);
      }  
    }

    return res.send({ error: error, data: data, message: message });
  };
  
}

module.exports = ResponseMgr;
