var Web3 = require("web3");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  return accept(tx, receipt);
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("Test error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("Test error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("Test contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of Test: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to Test.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: Test not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "default": {
    "abi": [
      {
        "constant": true,
        "inputs": [],
        "name": "customerADDR",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "rightInit",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "right",
            "type": "bytes32"
          },
          {
            "name": "incomeADDR",
            "type": "address"
          }
        ],
        "name": "freezeRight",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_firstName",
            "type": "bytes32"
          },
          {
            "name": "_lastName",
            "type": "bytes32"
          },
          {
            "name": "_account",
            "type": "address"
          }
        ],
        "name": "addBeneficiary",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "obligation",
            "type": "bytes32"
          },
          {
            "name": "incomeADDR",
            "type": "address"
          }
        ],
        "name": "freezeObligation",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "queryBalance",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "myid",
            "type": "bytes32"
          },
          {
            "name": "result",
            "type": "string"
          },
          {
            "name": "proof",
            "type": "bytes"
          }
        ],
        "name": "__callback",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getInfo",
        "outputs": [
          {
            "name": "",
            "type": "bytes32"
          },
          {
            "name": "",
            "type": "bytes32"
          },
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_firstName",
            "type": "bytes32"
          },
          {
            "name": "_lastName",
            "type": "bytes32"
          },
          {
            "name": "_age",
            "type": "uint256"
          },
          {
            "name": "_id",
            "type": "uint256"
          }
        ],
        "name": "addTarget",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getDefinition",
        "outputs": [
          {
            "name": "",
            "type": "bytes32"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "currentTime",
            "type": "uint256"
          }
        ],
        "name": "discard",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "currentTime",
            "type": "uint256"
          }
        ],
        "name": "payment",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "testing",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "obligationInit",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "currentTime",
            "type": "uint256"
          }
        ],
        "name": "destroy",
        "outputs": [
          {
            "name": "",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "_firstName",
            "type": "bytes32"
          },
          {
            "name": "_lastName",
            "type": "bytes32"
          },
          {
            "name": "_age",
            "type": "uint256"
          }
        ],
        "name": "addCustomer",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "payment",
            "type": "uint256"
          }
        ],
        "name": "receive",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "interval",
            "type": "uint256"
          }
        ],
        "name": "checkAlive",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "paymentNotify",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getRightStatus",
        "outputs": [
          {
            "name": "",
            "type": "bytes32[]"
          },
          {
            "name": "",
            "type": "bool[]"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "name": "balance",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getObligationStatus",
        "outputs": [
          {
            "name": "",
            "type": "bytes32[]"
          },
          {
            "name": "",
            "type": "bool[]"
          }
        ],
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "_createDate",
            "type": "uint256"
          }
        ],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [],
        "name": "trigger",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [],
        "name": "createTime",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [],
        "name": "pay",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [],
        "name": "paid",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [],
        "name": "userReceive",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "string"
          }
        ],
        "name": "paymentSuccess",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [],
        "name": "contractDestroy",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060408190526101f46003908155600060048190556107d06005556006556101906007557f596f2c207468697320697320612073696d706c6520636f6e7472616374000000600955600a819055600b556002600c556010805460b060020a60ff021960a060020a61ffff0219909116750100000000000000000000000000000000000000000017169055602080611a5b83395060806040525160008054600160a060020a03191673607b45e524311dd6857855c98adfecbe3cd1b94517905561011d7f110000000000000000000000000000000000000000000000000000000000000060008054600160a060020a0316141561025a5761025860005b6000600061036e731d3b2638a7cc9f2cb3d298a3da7a90b67e5506ed5b3b90565b600f8054600160a060020a031990811633908117808455600160a060020a031660009081526008602052604090206305f5e10090558254909116179055600d819055610249610e1061036181604060405190810160405280600381526020017f55524c0000000000000000000000000000000000000000000000000000000000815260200150608060405190810160405280604c81526020017f6a736f6e2868747470733a2f2f6170692e6b72616b656e2e636f6d2f302f707581526020017f626c69632f5469636b65723f706169723d455448584254292e726573756c742e81526020017f58455448585842542e632e300000000000000000000000000000000000000000815260200150600080548190600160a060020a03168114156104a3576104a160006100fc565b506113118061074a6000396000f35b505b600060009054906101000a9004600160a060020a0316600160a060020a03166338cc4831604051817c01000000000000000000000000000000000000000000000000000000000281526004018090506020604051808303816000876161da5a03f11561000257505060408051805160018054600160a060020a031916909117908190557f688dcfd70000000000000000000000000000000000000000000000000000000082527fff00000000000000000000000000000000000000000000000000000000000000851660048301529151600160a060020a0392909216925063688dcfd7916024808301926000929190829003018183876161da5a03f1156100025750505050565b5050565b5060005b919050565b11156103a2575060008054600160a060020a031916731d3b2638a7cc9f2cb3d298a3da7a90b67e5506ed1790556001610369565b60006103c1739efbea6358bed926b293d2ce63a730d6d98d43dd610119565b11156103f8575060008054739efbea6358bed926b293d2ce63a730d6d98d43dd600160a060020a0319919091161790556001610369565b60006104177320e12a1f859b3feae5fb2a0a32c18f5a65555bbf610119565b111561044e5750600080547320e12a1f859b3feae5fb2a0a32c18f5a65555bbf600160a060020a0319919091161790556001610369565b600061046d739a1d6e5c6c8d081ac45c6af98b74a42442afba60610119565b1115610365575060008054600160a060020a031916739a1d6e5c6c8d081ac45c6af98b74a42442afba601790556001610369565b505b600060009054906101000a9004600160a060020a0316600160a060020a03166338cc4831604051817c01000000000000000000000000000000000000000000000000000000000281526004018090506020604051808303816000876161da5a03f115610002575050604051805160018054600160a060020a031916909117908190557f524f388900000000000000000000000000000000000000000000000000000000825260206004838101828152895160248601528951600160a060020a0394909416955063524f3889948a9491938493604490920192868201929091829185918391869160009190601f850104600f02600301f150905090810190601f1680156105c35780820380516001836020036101000a031916815260200191505b50925050506020604051808303816000876161da5a03f11561000257505060405151915050670de0b6b3a764000062030d403a020181111561060c57600091505b509392505050565b600160009054906101000a9004600160a060020a0316600160a060020a031663adf59f9982878787604051857c01000000000000000000000000000000000000000000000000000000000281526004018084815260200180602001806020018381038352858181518152602001915080519060200190808383829060006004602084601f0104600f02600301f150905090810190601f1680156106c35780820380516001836020036101000a031916815260200191505b508381038252848181518152602001915080519060200190808383829060006004602084601f0104600f02600301f150905090810190601f16801561071c5780820380516001836020036101000a031916815260200191505b509550505050505060206040518083038185886185025a03f11561000257505060405151935061060491505056606060405236156101065760e060020a60003504631c28d2038114610108578063211327021461011a5780632a164836146101f35780632b45ee451461022d57806331a120ed1461028657806336f40c61146102bb57806338bbfa50146102dd5780635a9b0b89146103a45780636db91d0f146103c95780636f3d24c71461042b5780637e8f2b0c146104365780638b3c99e3146104595780638d03b10214610516578063991b8e861461051f5780639d1187701461057b578063c27bf04b146105a7578063cba2534f146105fe578063d12fb0c51461061f578063d40759d11461070a578063d6871d1c14610776578063e3d670d714610881578063e962555f14610899575b005b6109a4600f54600160a060020a031681565b6101065b600f8054600160a060020a03908116600090815260116020818152604080842060c860020a6664657374726f7902808652908352818520805460ff19908116600190811790925588548816875285855283872060d060020a656372656174650280895290865284882080548316841790559854909716865293835281852060c160020a673932b3b4b9ba32b9028087529084528286208054909716851790965560168054808601825586526018909352818520558154808401835584528084209590955580549182019055815291909120555b565b6101066004356024355b600160a060020a03811660009081526011602090815260408083208584529091529020805460ff191690555b5050565b6109c1600435602435604435604080516060810182528481526020818101859052600160a060020a038416928201839052601f86905584905560218054600160a060020a0319169092179091556001905b509392505050565b6101066004356024355b600160a060020a0316600090815260126020908152604080832093835292905220805460ff19169055565b6109d5600f54600160a060020a03166000908152600860205260409020545b90565b60408051602060248035600481810135601f81018590048502860185019096528585526101069581359591946044949293909201918190840183828082843750506040805160209735808a0135601f81018a90048a0283018a019093528282529698976064979196506024919091019450909250829150840183828082843750949650505050505050610a6c60008054600160a060020a0316811415610e9b57610e9960005b600060006111de731d3b2638a7cc9f2cb3d298a3da7a90b67e5506ed5b3b90565b6040805160135460145460155491835260208301528183015290519081900360600190f35b6109c16004356024356044356064356040805160a0810182526000608082018190528682526020820186905260608201859052918101839052601a869055601b859055601c839055601d849055601e805460ff19169055610bd3610e10610626565b6109d56009546102da565b6109c16004355b6000620d2f00600d6000505483031015610bfc57506001610c23565b61010660043560105460a060020a900460ff1615610c9b57600f5460078054600160a060020a039283166000908152600860205260408082208054909301909255825460105490941681528181208054949094039093559054600680549091019055517fdd301b0bf0fea5da79e5b93b6b2807ed8b070e2427a9949a5e52020bc9aa42449190a16006600050546005600050541415610c9b57601054610c719060ca60020a661c185e5b595b9d0290600160a060020a0316610290565b6109d560025481565b6101065b600f54600160a060020a0316600090815260126020908152604080832060ca60020a661c185e5b595b9d02808552908352818420805460ff191660019081179091556017805491820190558452601990925290912055565b6109c1600435600f54600090600160a060020a0390811633909116148015610c9e5750610c9e8261043d565b6109c16004356024356044356040805160a081018252600060608201819052608082018190528582526020820185905291810183905260138590556014849055601583905560168290556017829055610d5b61011e565b610106600435600f5433600160a060020a03908116911614610d6c57610c9b565b6101066004355b61022981604060405190810160405280600381526020017f55524c0000000000000000000000000000000000000000000000000000000000815260200150608060405190810160405280604c81526020017f6a736f6e2868747470733a2f2f6170692e6b72616b656e2e636f6d2f302f707581526020017f626c69632f5469636b65723f706169723d455448584254292e726573756c742e81526020017f58455448585842542e632e300000000000000000000000000000000000000000815260200150600080548190600160a060020a0316811415610f6d57610f6b6000610383565b61010660105460a060020a900460ff16158015610730575060105460a860020a900460ff165b8015610746575060105460b060020a900460ff16155b156101f1576040517f1b9265b8bc0c55eb496464034309ebd021bdafbb42ab85f2f0b2b006176744ee90600090a1565b6040805160208181018352600080835283518083018552818152845180840186528281528551938401865282845260165495516109e79692949193919282918059106107bf5750595b8181526020918202810190910160408190526016549195508059106107e15750595b90808252806020026020018201604052509250600091505b601654821015610e8e57506000818152601860205260409020548351819085908490811015610002576020908102909101810191909152600f54600160a060020a031660009081526011825260408082208483529092522054835160ff91909116908490849081101561000257911515602092830290910190910152600191909101906107f9565b6109d560043560086020526000908152604090205481565b6040805160208181018352600080835283518083018552818152845180840186528281528551938401865282845260175495516109e79692949193919282918059106108e25750595b8181526020918202810190910160408190526017549195508059106109045750595b90808252806020026020018201604052509250600091505b601754821015610e8e57506000818152601960205260409020548351819085908490811015610002576020908102909101810191909152600f54600160a060020a031660009081526012825260408082208483529092522054835160ff919091169084908490811015610002579115156020928302909101909101526001919091019061091c565b60408051600160a060020a03929092168252519081900360200190f35b604080519115158252519081900360200190f35b60408051918252519081900360200190f35b6040518080602001806020018381038352858181518152602001915080519060200190602002808383829060006004602084601f0104600f02600301f1509050018381038252848181518152602001915080519060200190602002808383829060006004602084601f0104600f02600301f15090500194505050505060405180910390f35b600160a060020a031633600160a060020a0316141515610a8b57610002565b6040517f7fec8d38d8975021f47b7d9a3f6787a8c2c71a0a0e3d1aa4227b68b0da47c96190600090a173__StringUtils___________________________6346bdca9a836040518260e060020a0281526004018080602001806020018381038352848181518152602001915080519060200190808383829060006004602084601f0104600f02600301f150905090810190601f168015610b3f5780820380516001836020036101000a031916815260200191505b50838103825260048152602001807f646561640000000000000000000000000000000000000000000000000000000081526020015060200193505050506020604051808303818660325a03f41561000257505060405151159050610bc8576010805475ff000000000000000000000000000000000000000000191660a860020a1790555b505050565b610bc3610e10610626565b60105460a860020a900460ff1615610bf057601e805460ff191690555b50600195945050505050565b600f54610c289060d060020a656372656174650290600160a060020a03166101fd565b5060005b919050565b600f54610c4d9060c160020a673932b3b4b9ba32b90290600160a060020a03166101fd565b600f54610c1f9060c860020a6664657374726f790290600160a060020a03166101fd565b6040517f295b4e173ace588a2d26726c3483cbedf2d8a415416100a23335461366e4283f90600090a15b50565b15610c23576010805476ff00000000000000000000000000000000000000000000191660b060020a178155600f805460048054600160a060020a0392831660009081526008602052604080822080549390930190925560068054955485168252828220805496909603909555915485548416835281832080549190910390559254935490911681528181208054909301909255517f3f89434bebcc9266efe357ef0728e7819976b40285a1346a642b766d5ce94bd09190a1919050565b610d63610523565b6001915061027e565b600f54600160a060020a03908116600090815260086020908152604080832080548690039055601054909316825290829020805484019055600480548401905581518181526007918101919091527f53756363657373000000000000000000000000000000000000000000000000008183015290517fd2d7f6ca608965348dbcbd2b05a2590c907421b05e0a0c11f50067d741c1a3cf9181900360600190a16003600050546004600050541415610c9b576010805474ff0000000000000000000000000000000000000000191660a060020a1790556040517f61dcd7ab6f2614780155a8696b0194498c02e6767faa1a8271d52c79b6344acb90600090a1600f54610c9b9060ca60020a661c185e5b595b9d0290600160a060020a0316610290565b509194909350915050565b505b600060009054906101000a9004600160a060020a0316600160a060020a03166338cc48316040518160e060020a0281526004018090506020604051808303816000876161da5a03f11561000257505060408051805160018054600160a060020a031916909117908190557fc281d19e0000000000000000000000000000000000000000000000000000000082529151600160a060020a0392909216925063c281d19e91600482810192602092919082900301816000876161da5a03f1156100025750506040515191506102da9050565b505b600060009054906101000a9004600160a060020a0316600160a060020a03166338cc48316040518160e060020a0281526004018090506020604051808303816000876161da5a03f115610002575050604051805160018054600160a060020a031916909117908190557f524f388900000000000000000000000000000000000000000000000000000000825260206004838101828152895160248601528951600160a060020a0394909416955063524f3889948a9491938493604490920192868201929091829185918391869160009190601f850104600f02600301f150905090810190601f1680156110745780820380516001836020036101000a031916815260200191505b50925050506020604051808303816000876161da5a03f11561000257505060405151915050670de0b6b3a764000062030d403a02018111156110b9576000915061027e565b600160009054906101000a9004600160a060020a0316600160a060020a031663adf59f99828787876040518560e060020a0281526004018084815260200180602001806020018381038352858181518152602001915080519060200190808383829060006004602084601f0104600f02600301f150905090810190601f1680156111575780820380516001836020036101000a031916815260200191505b508381038252848181518152602001915080519060200190808383829060006004602084601f0104600f02600301f150905090810190601f1680156111b05780820380516001836020036101000a031916815260200191505b509550505050505060206040518083038185886185025a03f11561000257505060405151935061027e915050565b1115611212575060008054600160a060020a031916731d3b2638a7cc9f2cb3d298a3da7a90b67e5506ed1790556001610c23565b6000611231739efbea6358bed926b293d2ce63a730d6d98d43dd6103a0565b1115611267575060008054739efbea6358bed926b293d2ce63a730d6d98d43dd600160a060020a03199091161790556001610c23565b60006112867320e12a1f859b3feae5fb2a0a32c18f5a65555bbf6103a0565b11156112bc5750600080547320e12a1f859b3feae5fb2a0a32c18f5a65555bbf600160a060020a03199091161790556001610c23565b60006112db739a1d6e5c6c8d081ac45c6af98b74a42442afba606103a0565b1115610c1f575060008054739a1d6e5c6c8d081ac45c6af98b74a42442afba60600160a060020a03199091161790556001610c2356",
    "events": {
      "0x591b4a9240326188b7e9ebf6341c04917836a6af50ba943295cdb297e3860308": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "result",
            "type": "uint256"
          }
        ],
        "name": "oncall",
        "type": "event"
      },
      "0xc603761c140e44e4d907b1d0249910cf597af9e0b32b5cf804fd2c1cc5d3ba87": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "tr",
            "type": "string"
          }
        ],
        "name": "trigger",
        "type": "event"
      },
      "0x075f6bb2c6abc4359c38e906f71341df01f753e0b5cb790cb15699cd4ab464e5": {
        "anonymous": false,
        "inputs": [],
        "name": "Shout",
        "type": "event"
      },
      "0x7fec8d38d8975021f47b7d9a3f6787a8c2c71a0a0e3d1aa4227b68b0da47c961": {
        "anonymous": false,
        "inputs": [],
        "name": "trigger",
        "type": "event"
      },
      "0xe2d46f98b280097f96c7e701567caeb4f12354a63c5de532417e4f1089a7c138": {
        "anonymous": false,
        "inputs": [],
        "name": "fulfilled",
        "type": "event"
      },
      "0x1bc404d652463aa0ad577a6788ecd5142afebcc164f0b2fb9e41fa3bc2c0dc72": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "uint256"
          }
        ],
        "name": "fulfilled",
        "type": "event"
      },
      "0x61dcd7ab6f2614780155a8696b0194498c02e6767faa1a8271d52c79b6344acb": {
        "anonymous": false,
        "inputs": [],
        "name": "createTime",
        "type": "event"
      },
      "0xd40759d15c7678629930065f74951109ef4c7b8620250f605970a5fde128fb16": {
        "anonymous": false,
        "inputs": [],
        "name": "paymentNotify",
        "type": "event"
      },
      "0x295b4e173ace588a2d26726c3483cbedf2d8a415416100a23335461366e4283f": {
        "anonymous": false,
        "inputs": [],
        "name": "paid",
        "type": "event"
      },
      "0x1b9265b8bc0c55eb496464034309ebd021bdafbb42ab85f2f0b2b006176744ee": {
        "anonymous": false,
        "inputs": [],
        "name": "pay",
        "type": "event"
      },
      "0xdd301b0bf0fea5da79e5b93b6b2807ed8b070e2427a9949a5e52020bc9aa4244": {
        "anonymous": false,
        "inputs": [],
        "name": "userReceive",
        "type": "event"
      },
      "0x405104fd37e69a15c1080f6f9d5132555cf7399c6b34c39a78435a409fd30134": {
        "anonymous": false,
        "inputs": [],
        "name": "paymentSuccess",
        "type": "event"
      },
      "0xaf400fb4d5471ad8066201f2110267515e6c62efe72e61581120efb821091816": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "bool"
          }
        ],
        "name": "paymentSuccess",
        "type": "event"
      },
      "0xd2d7f6ca608965348dbcbd2b05a2590c907421b05e0a0c11f50067d741c1a3cf": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "",
            "type": "string"
          }
        ],
        "name": "paymentSuccess",
        "type": "event"
      }
    },
    "updated_at": 1476625349906,
    "links": {
      "StringUtils": "0x205314f71527ee020cdb58fc79d9971af6979918"
    },
    "address": "0x60b8e8baaeb9de2020e00a9e2c43000f6f4f49b4"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "object") {
      Object.keys(name).forEach(function(n) {
        var a = name[n];
        Contract.link(n, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "Test";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.1.2";

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.Test = Contract;
  }
})();
