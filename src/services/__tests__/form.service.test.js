jest.mock("../../repositories/base-versioned.repository", () => {
  return jest.fn().mockImplementation(function FakeBaseVersionedRepository() {
    this.table = arguments[1];
    this.getLatestOrThrow = jest.fn();
    this.getLatestByRootId = jest.fn();
    this.findById = jest.fn();
    this.updateByRootId = jest.fn(async (rootid, patch = {}) => ({
      id: 201,
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
const FormService = require("../form.service");

describe("form.service", () => {
  describe("migrateFormToLatestSchema", () => {
    test("creates one new current version for the migrated form", async () => {
      const db = {
        query: jest.fn(async () => ({ rows: [] })),
        connect: jest.fn(async () => ({
          query: jest.fn(async () => ({})),
          release: jest.fn(),
        })),
      };

      const service = new FormService(db);

      service.repo.getLatestByRootId.mockResolvedValue({
        id: 31,
        _rootid: 30,
        data_schema_id: 11,
        data_schema_rootid: 11,
        payload: { controls: [{ databind: "name" }] },
      });

      service.schemaService.compareSchemaWithLatest = jest.fn(async () => ({
        isLatest: false,
        oldSchema: { id: 11, _rootid: 11, payload: { name: { type: "string" } } },
        latestSchema: { id: 12, _rootid: 11, payload: { name: { type: "string" } } },
        compare: { name: { status: "ok" } },
      }));

      const result = await service.migrateFormToLatestSchema(30, {
        force: true,
      });

      const txRepo = BaseVersionedRepository.mock.instances.find(
        (instance) => instance.table === "form"
      );

      expect(service.repo.getLatestByRootId).toHaveBeenCalledWith(30, {});
      expect(service.schemaService.compareSchemaWithLatest).toHaveBeenCalledWith(11);
      expect(txRepo.table).toBe("form");
      expect(txRepo.updateByRootId).toHaveBeenCalledTimes(1);
      expect(txRepo.updateByRootId.mock.calls[0][0]).toBe(30);
      expect(txRepo.updateByRootId.mock.calls[0][1]).toEqual({
        data_schema_id: 12,
        data_schema_rootid: 11,
        payload: {
          controls: [
            {
              databind: "name",
              status: "ok",
              message: null,
            },
          ],
        },
      });
      expect(result.migrated).toBe(true);
      expect(result.form.id).toBe(201);
    });
  });
});