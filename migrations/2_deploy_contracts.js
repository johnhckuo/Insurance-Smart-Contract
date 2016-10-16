module.exports = function(deployer) {
  deployer.deploy(usingOraclize);
  deployer.deploy(StringUtils);
  deployer.autolink();
  deployer.deploy(Test);
};
