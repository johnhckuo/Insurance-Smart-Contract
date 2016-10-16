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
      throw new Error("Yo error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("Yo error: contract binary not set. Can't deploy new instance.");
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

      throw new Error("Yo contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of Yo: " + unlinked_libraries);
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
      throw new Error("Invalid address passed to Yo.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: Yo not deployed or address not set.");
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
        "name": "ora",
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
        "inputs": [
          {
            "name": "delay",
            "type": "uint256"
          }
        ],
        "name": "update",
        "outputs": [],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "name": "",
            "type": "address"
          }
        ],
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
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
        "name": "ETHXBT",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "result",
            "type": "uint256"
          }
        ],
        "name": "trig",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "type": "function"
      },
      {
        "inputs": [],
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [],
        "name": "trigger",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405260008054600160a060020a03191673607b45e524311dd6857855c98adfecbe3cd1b9451790556100887f110000000000000000000000000000000000000000000000000000000000000060008054600160a060020a031614156101815761017f60005b60006000610295731d3b2638a7cc9f2cb3d298a3da7a90b67e5506ed5b3b90565b610171600061028881604060405190810160405280600381526020017f55524c0000000000000000000000000000000000000000000000000000000000815260200150608060405190810160405280604c81526020017f6a736f6e2868747470733a2f2f6170692e6b72616b656e2e636f6d2f302f707581526020017f626c69632f5469636b65723f706169723d455448584254292e726573756c742e81526020017f58455448585842542e632e300000000000000000000000000000000000000000815260200150600080548190600160a060020a03168114156103ca576103c86000610067565b610934806106726000396000f35b505b600060009054906101000a9004600160a060020a0316600160a060020a03166338cc4831604051817c01000000000000000000000000000000000000000000000000000000000281526004018090506020604051808303816000876161da5a03f11561000257505060408051805160018054600160a060020a031916909117908190557f688dcfd70000000000000000000000000000000000000000000000000000000082527fff00000000000000000000000000000000000000000000000000000000000000851660048301529151600160a060020a0392909216925063688dcfd7916024808301926000929190829003018183876161da5a03f1156100025750505050565b5050565b5060005b919050565b11156102c9575060008054600160a060020a031916731d3b2638a7cc9f2cb3d298a3da7a90b67e5506ed1790556001610290565b60006102e8739efbea6358bed926b293d2ce63a730d6d98d43dd610084565b111561031f575060008054739efbea6358bed926b293d2ce63a730d6d98d43dd600160a060020a0319919091161790556001610290565b600061033e7320e12a1f859b3feae5fb2a0a32c18f5a65555bbf610084565b11156103755750600080547320e12a1f859b3feae5fb2a0a32c18f5a65555bbf600160a060020a0319919091161790556001610290565b6000610394739a1d6e5c6c8d081ac45c6af98b74a42442afba60610084565b111561028c575060008054600160a060020a031916739a1d6e5c6c8d081ac45c6af98b74a42442afba601790556001610290565b505b600060009054906101000a9004600160a060020a0316600160a060020a03166338cc4831604051817c01000000000000000000000000000000000000000000000000000000000281526004018090506020604051808303816000876161da5a03f115610002575050604051805160018054600160a060020a031916909117908190557f524f388900000000000000000000000000000000000000000000000000000000825260206004838101828152895160248601528951600160a060020a0394909416955063524f3889948a949193849360449290920192868201929091829185918391869160009190601f850104600302600f01f150905090810190601f1680156104eb5780820380516001836020036101000a031916815260200191505b50925050506020604051808303816000876161da5a03f11561000257505060405151915050670de0b6b3a764000062030d403a020181111561053457600091505b509392505050565b600160009054906101000a9004600160a060020a0316600160a060020a031663adf59f9982878787604051857c01000000000000000000000000000000000000000000000000000000000281526004018084815260200180602001806020018381038352858181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156105eb5780820380516001836020036101000a031916815260200191505b508381038252848181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156106445780820380516001836020036101000a031916815260200191505b509550505050505060206040518083038185886185025a03f11561000257505060405151935061052c91505056606060405236156100615760e060020a600035046338bbfa50811461006357806374d1bc8c1461012b57806382ab890a1461013d5780638da5cb5b14610228578063b69ef8a81461023a578063b776447514610243578063d81a8023146102a1575b005b60408051602060248035600481810135601f81018590048502860185019096528585526100619581359591946044949293909201918190840183828082843750506040805160209735808a0135601f81018a90048a0283018a0190935282825296989760649791965060249190910194509092508291508401838280828437509496505050505050506103505b60008054600160a060020a03168114156104b5576104b360005b600060006107f9731d3b2638a7cc9f2cb3d298a3da7a90b67e5506ed5b3b90565b6102b3600554600160a060020a031681565b6100616004355b61044481604060405190810160405280600381526020017f55524c0000000000000000000000000000000000000000000000000000000000815260200150608060405190810160405280604c81526020017f6a736f6e2868747470733a2f2f6170692e6b72616b656e2e636f6d2f302f707581526020017f626c69632f5469636b65723f706169723d455448584254292e726573756c742e81526020017f58455448585842542e632e300000000000000000000000000000000000000000815260200150600080548190600160a060020a031681141561058457610582600061010a565b6102b3600454600160a060020a031681565b6102d060025481565b6040805160038054602060026001831615610100026000190190921691909104601f81018290048202840182019094528383526102e293908301828280156104735780601f1061044857610100808354040283529160200191610473565b6102d060043560006104a36000610144565b60408051600160a060020a03929092168252519081900360200190f35b60408051918252519081900360200190f35b60405180806020018281038252838181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156103425780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b600160a060020a031633600160a060020a031614151561036f57610002565b6040517f7fec8d38d8975021f47b7d9a3f6787a8c2c71a0a0e3d1aa4227b68b0da47c96190600090a18160036000509080519060200190828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f106103ff57805160ff19168380011785555b5061042f9291505b8082111561043b57600081556001016103eb565b828001600101855582156103e3579182015b828111156103e3578251826000505591602001919060010190610411565b505061043f6005610144565b5090565b505050565b5050565b820191906000526020600020905b81548152906001019060200180831161045657829003601f168201915b505050505081565b60058054600160a060020a03199081169092179055600480549091163317905550805b919050565b600280548301905561047b6100f0565b505b600060009054906101000a9004600160a060020a0316600160a060020a03166338cc48316040518160e060020a0281526004018090506020604051808303816000876161da5a03f11561000257505060408051805160018054600160a060020a031916909117908190557fc281d19e0000000000000000000000000000000000000000000000000000000082529151600160a060020a0392909216925063c281d19e91600482810192602092919082900301816000876161da5a03f1156100025750506040515191505090565b505b600060009054906101000a9004600160a060020a0316600160a060020a03166338cc48316040518160e060020a0281526004018090506020604051808303816000876161da5a03f115610002575050604051805160018054600160a060020a031916909117908190557f524f388900000000000000000000000000000000000000000000000000000000825260206004838101828152895160248601528951600160a060020a0394909416955063524f3889948a9491938493604490920192868201929091829185918391869160009190601f850104600302600f01f150905090810190601f16801561068b5780820380516001836020036101000a031916815260200191505b50925050506020604051808303816000876161da5a03f11561000257505060405151915050670de0b6b3a764000062030d403a02018111156106d457600091505b509392505050565b600160009054906101000a9004600160a060020a0316600160a060020a031663adf59f99828787876040518560e060020a0281526004018084815260200180602001806020018381038352858181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156107725780820380516001836020036101000a031916815260200191505b508381038252848181518152602001915080519060200190808383829060006004602084601f0104600302600f01f150905090810190601f1680156107cb5780820380516001836020036101000a031916815260200191505b509550505050505060206040518083038185886185025a03f1156100025750506040515193506106cc915050565b111561082d575060008054600160a060020a031916731d3b2638a7cc9f2cb3d298a3da7a90b67e5506ed179055600161049e565b600061084c739efbea6358bed926b293d2ce63a730d6d98d43dd610127565b1115610883575060008054739efbea6358bed926b293d2ce63a730d6d98d43dd600160a060020a031991909116179055600161049e565b60006108a27320e12a1f859b3feae5fb2a0a32c18f5a65555bbf610127565b11156108d95750600080547320e12a1f859b3feae5fb2a0a32c18f5a65555bbf600160a060020a031991909116179055600161049e565b60006108f8739a1d6e5c6c8d081ac45c6af98b74a42442afba60610127565b111561092c575060008054600160a060020a031916739a1d6e5c6c8d081ac45c6af98b74a42442afba60179055600161049e565b50600061049e56",
    "events": {
      "0x7fec8d38d8975021f47b7d9a3f6787a8c2c71a0a0e3d1aa4227b68b0da47c961": {
        "anonymous": false,
        "inputs": [],
        "name": "trigger",
        "type": "event"
      },
      "0xed684cc686bb0888b0d2bfe3077dc5ac4cb962c7070bcfccc5cfa3b7b0fe8319": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "result",
            "type": "uint256"
          }
        ],
        "name": "trigger",
        "type": "event"
      }
    },
    "updated_at": 1476624079367,
    "links": {},
    "address": "0xc4a2e45f00850399028342d90d7d17200c117c6b"
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

  Contract.contract_name   = Contract.prototype.contract_name   = "Yo";
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
    window.Yo = Contract;
  }
})();
