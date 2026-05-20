// src/services/business.service.js

const BaseVersionedRepository = require("../repositories/base-versioned.repository");

class BusinessService {
  constructor(db) {
    this.repo = new BaseVersionedRepository(db, "business");
  }

  async createBusiness({ name, icon = null }) {
    if (!name || !name.trim()) {
      const err = new Error("name is required");
      err.status = 400;
      throw err;
    }

    return this.repo.create({ name: name.trim(), icon });
  }

  async updateBusiness(rootid, updates) {
    return this.repo.updateByRootId(rootid, updates);
  }

  async getBusinessById(id) {
    return this.repo.findById(id);
  }

  async getLatestByRootId(rootid, options = {}) {
    return this.repo.getLatestByRootId(rootid, options);
  }

  async listLatest(options = {}) {
    return this.repo.listLatest(options);
  }

  async getHistory(rootid, options = {}) {
  return this.repo.getHistory(rootid, options);
}

  async deleteBusiness(rootid) {
    return this.repo.softDeleteByRootId(rootid);
  }
}

module.exports = BusinessService;
