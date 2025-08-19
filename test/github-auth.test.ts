import { expect } from 'chai';
import * as sinon from 'sinon';
import ConfigManager from '../src/lib/config-manager';
import GitHubAuth from '../src/lib/github-auth';

describe('GitHub Authentication', () => {
  let configManager: ConfigManager;
  let githubAuth: GitHubAuth;
  let configStub: sinon.SinonStub;
  
  beforeEach(() => {
    configManager = new ConfigManager();
    githubAuth = new GitHubAuth(configManager);
    
    // Stub the config manager
    configStub = sinon.stub(configManager, 'getConfig');
  });
  
  afterEach(() => {
    sinon.restore();
  });
  
  describe('getAuthStatus', () => {
    it('should return not authenticated when no token exists', () => {
      configStub.returns({});
      
      const status = githubAuth.getAuthStatus();
      
      expect(status.authenticated).to.be.false;
      expect(status.username).to.be.undefined;
    });
    
    it('should return authenticated when token exists', () => {
      configStub.returns({
        github: {
          token: 'test-token',
          username: 'octocat',
        },
      });
      
      const status = githubAuth.getAuthStatus();
      
      expect(status.authenticated).to.be.true;
      expect(status.username).to.equal('octocat');
    });
    
    it('should include expiry information when available', () => {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7); // 7 days from now
      
      configStub.returns({
        github: {
          token: 'test-token',
          username: 'octocat',
          expiresAt: expiryDate.toISOString(),
        },
      });
      
      const status = githubAuth.getAuthStatus();
      
      expect(status.authenticated).to.be.true;
      expect(status.username).to.equal('octocat');
      expect(status.expiresAt).to.equal(expiryDate.toISOString());
    });
  });
  
  describe('disconnect', () => {
    it('should remove GitHub credentials from config', () => {
      const updateConfigStub = sinon.stub(configManager, 'updateConfig');
      
      githubAuth.disconnect();
      
      expect(updateConfigStub.calledOnce).to.be.true;
      expect(updateConfigStub.firstCall.args[0]).to.deep.equal({
        github: undefined,
      });
    });
  });
});