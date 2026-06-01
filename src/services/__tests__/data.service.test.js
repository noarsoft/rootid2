jest.mock("../../repositories/base-versioned.repository", () => {
  return jest.fn().mockImplementation(function FakeBaseVersionedRepository() {
    this.table = arguments[1];
    this.getLatestOrThrow = jest.fn();
    this.getLatestByRootId = jest.fn();
    this.findById = jest.fn();
    this.updateByRootId = jest.fn(async (rootid, patch = {}) => ({
      id: 101,
      _rootid: rootid,
      data_schema_id: patch.data_schema_id,
      payload: patch.payload,
    }));
    this.create = jest.fn();
    this.listLatest = jest.fn();
    this.getHistory = jest.fn();
    this.softDeleteByRootId = jest.fn();
    this.restoreVersion = jest.fn();
  });
});

const BaseVersionedRepository = require("../../repositories/base-versioned.repository");
const DataService = require("../data.service");

describe("data.service", () => {
  describe("migrateDataToLatestSchema", () => {
    test("creates a single new current version for the migrated data", async () => {
      const db = {
        query: jest.fn(async () => ({ rows: [] })),
        connect: jest.fn(async () => ({
          query: jest.fn(async () => ({})),
          release: jest.fn(),
        })),
      };

      const service = new DataService(db);

      service.repo.getLatestByRootId.mockResolvedValue({
        id: 11,
        _rootid: 10,
        user_id: 1,
        share_mode: "self",
        data_schema_id: 1,
        payload: { name: "A" },
      });

      service.schemaService.mapPayloadToLatestSchema = jest.fn(async () => ({
        isLatest: false,
        oldSchema: { id: 1, _rootid: 1 },
        latestSchema: { id: 2, _rootid: 1 },
        payload: { name: "A" },
        warnings: [],
        compare: {},
      }));

      const result = await service.migrateDataToLatestSchema(10, {
        auth: { user: { id: 1 } },
      });

      const txRepo = BaseVersionedRepository.mock.instances.at(-1);

      expect(service.repo.getLatestByRootId).toHaveBeenCalledWith(10, {
        includeDeleted: false,
        auth: { user: { id: 1 } },
      });
      expect(service.schemaService.mapPayloadToLatestSchema).toHaveBeenCalledWith(
        1,
        { name: "A" }
      );
      expect(txRepo.table).toBe("data");
      expect(txRepo.updateByRootId).toHaveBeenCalledTimes(1);
      expect(txRepo.updateByRootId.mock.calls[0][0]).toBe(10);
      expect(txRepo.updateByRootId.mock.calls[0][1]).toEqual({
        data_schema_id: 2,
        payload: { name: "A" },
      });
      expect(result.migrated).toBe(true);
      expect(result.data.data_schema_id).toBe(2);
    });
  });
});