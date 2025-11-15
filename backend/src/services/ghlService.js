import axios from 'axios';

class GHLService {
  constructor(apiKey, locationId) {
    this.apiKey = apiKey;
    this.locationId = locationId;
    this.baseURL = 'https://rest.gohighlevel.com/v1';
  }

  async createContact(phoneNumber, name) {
    // TODO: Implement GHL API call
    console.log('Creating contact in GHL:', phoneNumber, name);
  }

  async syncMessage(messageData) {
    // TODO: Implement message sync
    console.log('Syncing message to GHL:', messageData);
  }
}

export default GHLService;
