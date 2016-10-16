var accounts;
var account;
var balance;

var test;
function getPrice(){

    //var test = Test.deployed();

    test.trig(10,{from:account}).then();
    test.balance.call({from:account}).then(alert);
}

function getDefinition(){

  test.getDefinition().then(function(result){
    printConsole(hex2a(result), "合約內容");
  });
}
function receive(){

  test.receive(500, {from:account}).then(console.log);
}

function getObligationStatus(){
  var obligationCount;
  test.getObligationStatus({from:account}).then(function(result){
    //console.log(result[0]);
    var stringCount = result[0].length;
    var content = [];
    for (var i = 0 ; i < stringCount ; i++){
      content.push(i+'. '+hex2a(result[0][i]) +' : '+ result[1][i]+"<br>");
    }
    printConsole(content);
  })
}

function getRightStatus(){

  var rightCount;
  test.getRightStatus({from:account}).then(function(result){
    //console.log(result[0]);
    var stringCount = result[0].length;
    var content = [];
    for (var i = 0 ; i < stringCount ; i++){
      content.push(i+'. '+hex2a(result[0][i]) +' : '+ result[1][i]+"<br>");
    }
    printConsole(content);
  })

}


function queryBalance(){
  test.queryBalance({from:account}).then(function(result){
    printConsole("Current balance left: "+result.c[0]);

  });
}

function addCustomer(){
  //var test = Test.deployed();
  test.addCustomer('john', 'kuo', 12,{from:account}).then(printConsole);
}

function addTarget(){
  //var test = Test.deployed();
  test.addTarget('john', 'kuo', 12, 235, {from:account}).then(printConsole);
}

function addBeneficiary(){
  //var test = Test.deployed();
  test.addBeneficiary('john', 'kuo', accounts[1], {from:account}).then(printConsole);
}

function getCustomer(){
  //var test = Test.deployed();
  test.getInfo({from:account}).then(function(result){
    console.log(result);
    var outcome = [];
    for (var i = 0 ; i< result.length; i++){
      if (typeof result[i] != 'object'){
        outcome.push(hex2a(result[i]));
      }else{
        outcome.push(result[i].c[0]);
      }
    }
    printConsole(outcome);
  });
}
function init(event){
  Test.new(100, { from: accounts[0] }).then(function(obj){
    test = obj;

    //傾聽事件
    test.createTime().watch(function(error, result){
      if (!error)
        alert("contract created!");
    });
    test.pay().watch(function(error, result){
      if (!error)
        alert("Time to pay!");
    });

    test.userReceive().watch(function(error, result){
      if (!error)
        alert("money transferred");
    });

    test.paid().watch(function(error, result){
      if (!error)
        alert("All paid by company");
    });

    test.paymentSuccess().watch(function(error, result){
      if (!error)
        printConsole(result.args);
    });

    test.contractDestroy().watch(function(error, result){
      if (!error)
        printConsole("合約終止");
    });

      console.log(test.address)
    printConsole("<p>合約位址："+test.address+"</p><p>交易Hash："+test.transactionHash+"</p>", "建立成功");
  });
}

function printConsole(output,title){
  if (title == undefined){
    title='通知';
  }
  document.getElementById("consoleTitle").innerHTML = title;
  document.getElementById("console").innerHTML = output;
}
function hex2a(hexx) {
    var hex = hexx.toString();//force conversion
    var str = '';
    for (var i = 0; i < hex.length; i += 2)
        str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
}

function destroy(){
  test.destroy(100, {from:account}).then(printConsole);
}


window.onload = function() {
  web3.eth.getAccounts(function(err, accs) {
    if (err != null) {
      alert("There was an error fetching your accounts.");
      return;
    }

    if (accs.length == 0) {
      alert("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.");
      return;
    }

    accounts = accs;
    account = accounts[0];

  });
}
