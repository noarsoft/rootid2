jest.mock("../../repositories/base-versioned.repository", () => {
  return jest.fn().mockImplementation(function FakeBaseVersionedRepository() {
    this.table = arguments[1];
    this.getLatestOrThrow = jest.fn();
    this.getLatestByRootId = jest.fn();
    this.findById = jest.fn();
    this.updateByRootId = jest.fn(async (rootid, patch = {}) => ({
      id: 301,
      _rootid: rootid,
      data_schema_id: patch.data_schema_id,
      data_schema_rootid: patch.data_schema_rootid,
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
const ViewService = require("../view.service");

describe("view.service", () => {
  describe("migrateViewToLatestSchema", () => {
    test("creates one new current version for the migrated view", async () => {
      const db = {
        query: jest.fn(async () => ({ rows: [] })),
        connect: jest.fn(async () => ({
          query: jest.fn(async () => ({})),
          release: jest.fn(),
        })),
      };

      const service = new ViewService(db);

      service.repo.getLatestByRootId.mockResolvedValue({
        id: 41,
        _rootid: 40,
        data_schema_id: 21,
        data_schema_rootid: 21,
        payload: { columns: [{ databind: "title" }] },
      });

      service.schemaService.compareSchemaWithLatest = jest.fn(async () => ({
        isLatest: false,
        oldSchema: { id: 21, _rootid: 21, payload: { title: { type: "string" } } },
        latestSchema: { id: 22, _rootid: 21, payload: { title: { type: "string" } } },
        compare: { title: { status: "ok" } },
      }));

      const result = await service.migrateViewToLatestSchema(40, {
        force: true,
      });

      const txRepo = BaseVersionedRepository.mock.instances.find(
        (instance) => instance.table === "tableview"
      );

      expect(service.repo.getLatestByRootId).toHaveBeenCalledWith(40, {});
      expect(service.schemaService.compareSchemaWithLatest).toHaveBeenCalledWith(21);
      expect(txRepo.table).toBe("tableview");
      expect(txRepo.updateByRootId).toHaveBeenCalledTimes(1);
      expect(txRepo.updateByRootId.mock.calls[0][0]).toBe(40);
      expect(txRepo.updateByRootId.mock.calls[0][1]).toEqual({
        data_schema_id: 22,
        data_schema_rootid: 21,
        payload: {
          columns: [
            {
              databind: "title",
              status: "ok",
              message: null,
            },
          ],
        },
      });
      expect(result.migrated).toBe(true);
      expect(result.view.id).toBe(301);
    });
  });
});