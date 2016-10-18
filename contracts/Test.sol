import "./usingOraclize.sol";
import "./StringUtils.sol";

contract Test is usingOraclize {
  uint public testing;
  uint customerPaidTotal= 500;
  uint customerPaid = 0;
  uint companyPaidTotal = 2000;
  uint companyPaid = 0;
  uint companyPayment = 400;

  event trigger();
  event createTime();
  event pay();
  event paid();
  event userReceive();
  event paymentSuccess(string);
  event contractDestroy();
  // for demo 模擬死亡用事件
  event dead();

  mapping (address => uint) public balance;
  bytes32 definition = "Yo, this is a simple contract";

  uint obligationsLength = 3;
  uint rightsLength = 3 ;
  uint characterLength = 2;

  uint createDate;
  uint destroyDate;

  address public customerADDR;
  address companyADDR;

  //要保人義務執行狀態
  bool fulfill = false;
  //保戶狀態變數
  bool alive = true;
  //合約狀態變數
  bool destroyed = false;

  mapping (address => mapping(bytes32 => bool)) rights;
  mapping (address => mapping(bytes32 => bool)) obligations;

  //要保人
  struct Customer{
    bytes32 firstName;
    bytes32 lastName;
    uint age;

    uint rightsIndexCount;
    uint obligationsIndexCount;
    mapping (uint => bytes32) rightsIndex;
    mapping (uint => bytes32) obligationsIndex;
  }
  //受益人
  struct Beneficiary{
    bytes32 firstName;
    bytes32 lastName;
    address account;
  }
  //被保戶
  struct Target{
    bytes32 firstName;
    bytes32 lastName;
    uint id;
    uint age;
    bool status;
  }

  Customer customer;
  Target target;
  Beneficiary beneficiary;


  //--------constructor----------
  function Test(uint _createDate){
    OAR = OraclizeAddrResolverI(0x607b45e524311dd6857855c98adfecbe3cd1b945);
    oraclize_setProof(proofType_TLSNotary | proofStorage_IPFS);

    customerADDR = msg.sender;
    balance[customerADDR] = 100000000;

    customerADDR = msg.sender;
    createDate = _createDate;

    checkAlive(3600);

  }

  //--------contract definition----------

  function getDefinition() constant returns(bytes32){
    return definition;
  }

  //----payment-----

  function receive(uint payment){
    if (msg.sender != customerADDR){
      return;
    }
    balance[customerADDR] -=  payment;
    balance[companyADDR] += payment;

    customerPaid += payment;
    paymentSuccess("Success");
    if (customerPaid == customerPaidTotal){
      fulfill = true;
      createTime();
      freezeObligation("payment", customerADDR);
    }
  }

  function queryBalance() constant returns(uint){
    return balance[customerADDR];
  }

  //------right--------
  function rightInit(){
    rights[customerADDR]["destroy"] = true;
    rights[customerADDR]["create"] = true;
    rights[customerADDR]["register"] = true;

    customer.rightsIndex[customer.rightsIndexCount++] = "destroy";
    customer.rightsIndex[customer.rightsIndexCount++] = "create";
    customer.rightsIndex[customer.rightsIndexCount++] = "register";
  }
  function freezeRight(bytes32 right, address incomeADDR){
    rights[incomeADDR][right] = false;

  }

  function getRightStatus() constant returns(bytes32[], bool[]){
    //return rights[customerADDR][right];

    bytes32[] memory stringArr = new bytes32[](customer.rightsIndexCount);
    bool[] memory boolArr = new bool[](customer.rightsIndexCount);
    for (uint i = 0 ; i < customer.rightsIndexCount; i++){
      bytes32 right  = customer.rightsIndex[i];
      stringArr[i] = right;
      boolArr[i] = rights[customerADDR][right];
    }

    return (stringArr, boolArr);
  }
  //----obligation-----
  function obligationInit(){

    obligations[customerADDR]["payment"] = true;
    customer.obligationsIndex[customer.obligationsIndexCount++] = "payment";

  }


  function freezeObligation(bytes32 obligation, address incomeADDR){
    obligations[incomeADDR][obligation] = false;
  }

  function getObligationStatus() constant returns(bytes32[], bool[]){

    bytes32[] memory stringArr = new bytes32[](customer.obligationsIndexCount);
    bool[] memory boolArr = new bool[](customer.obligationsIndexCount);
    for (uint i = 0 ; i < customer.obligationsIndexCount; i++){
      bytes32 obligation  = customer.obligationsIndex[i];
      stringArr[i] = obligation;
      boolArr[i] = obligations[customerADDR][obligation];
    }

    return (stringArr, boolArr);
  }


  //--------contract start and end--------

  function destroy(uint currentTime) returns(bool){
    if (msg.sender == customerADDR && discard(currentTime)){
        //suicide(customerADDR);
        destroyed = true;    //contract status!
        balance[customerADDR] += customerPaid;
        balance[customerADDR] -= companyPaid;

        balance[companyADDR] -= customerPaid;
        balance[companyADDR] += companyPaid;
        contractDestroy();
    }
  }

  function discard(uint currentTime) returns(bool){
    if (currentTime - createDate < 864000){
      return true;
    }else{
      freezeRight('create',customerADDR);
      freezeRight('register',customerADDR);
      freezeRight('destroy',customerADDR);
      return false;
    }

  }


  //-------checkAlive---------

  function checkAlive(uint interval){
    //just sample URL
    oraclize_query(interval, "URL", "json(https://api.kraken.com/0/public/Ticker?pair=ETHXBT).result.XETHXXBT.c.0");

  }
  //-----oracle callback------


  function __callback(bytes32 myid, string result, bytes proof) {
      if (msg.sender != oraclize_cbAddress()) throw;
      trigger();
      if (StringUtils.equal(result, "dead")){
        alive = true;
        return;
      }
      checkAlive(3600);
  }

  //----- customer -------

  function addCustomer(bytes32 _firstName, bytes32 _lastName, uint _age) returns(bool success){
    Customer memory newCustomer;
    newCustomer.firstName = _firstName;
    newCustomer.lastName = _lastName;
    newCustomer.age = _age;
    //customers.push(newCustomer);
    customer = newCustomer;
    rightInit();
    obligationInit();
    return true;

  }


  function addBeneficiary(bytes32 _firstName, bytes32 _lastName, address _account) returns(bool success){
    Beneficiary memory newBeneficiary;
    newBeneficiary.firstName = _firstName;
    newBeneficiary.lastName = _lastName;
    newBeneficiary.account = _account;
    beneficiary = newBeneficiary;
    return true;

  }

  function addTarget(bytes32 _firstName, bytes32 _lastName, uint _age, uint _id) returns(bool success){
    Target memory newTarget;
    newTarget.firstName = _firstName;
    newTarget.lastName = _lastName;
    newTarget.age = _age;
    newTarget.id = _id;
    target = newTarget;
    checkAlive(3600);
    if (alive){
      target.status = false;
    }
    return true;

  }

  function getInfo() constant returns(bytes32, bytes32, uint){
    return (customer.firstName, customer.lastName, customer.age);
  }

  // called by cron node


  //通知客戶繳錢
  function paymentNotify(){
    if (!fulfill && alive && !destroyed){
      pay();

    }
  }

  //公司繳錢
  function payment(uint currentTime){
    if (fulfill){
      balance[customerADDR] += companyPayment;
      balance[companyADDR] -= companyPayment;
      companyPaid += companyPayment;
      userReceive();

      if (companyPaidTotal == companyPaid ){
        freezeObligation("payment", companyADDR);
        paid();
      }
    }
  }

  // for demo 模擬死亡用事件
  function die() {
    alive = false;
    target.status = true;
    dead();
  }
}
