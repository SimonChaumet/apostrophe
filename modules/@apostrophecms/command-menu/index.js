const assert = require('assert').strict;
const pipe = (...functions) => (initial) => functions.reduce((accumulator, current) => current(accumulator), initial);

module.exports = {
  options: {
    components: {},
    alias: 'commandMenu'
  },
  commands(self) {
    return {
      add: {
        [`${self.__meta.name}:show-shortcut-list`]: {
          type: 'item',
          label: 'apostrophe:commandMenuShowShortcutList',
          action: {
            type: 'open-modal',
            payload: {
              name: 'AposCommandMenuShortcut',
              props: { moduleName: '@apostrophecms/command-menu' }
            }
          },
          shortcut: '?'
        }
      },
      group: {
        '@apostrophecms/command-menu:general': {
          label: 'apostrophe:commandMenuGeneral',
          fields: [
            `${self.__meta.name}:show-shortcut-list`
          ]
        }
      }
    };
  },
  init(self) {
    self.rawCommands = [];
    self.removes = [];
    self.commands = {};
    self.groups = {};
    self.modals = {};

    self.addShortcutModal();
    self.enableBrowserData();
  },
  handlers(self) {
    return {
      'apostrophe:ready': {
        composeCommands() {
          self.rawCommands = Object.values(self.apos.modules).flatMap(self.composeCommandsForModule);
          self.removes = [];
          self.commands = {};
          self.groups = {};
          self.modals = {};

          const composed = pipe(self.composeCommand, self.composeRemove, self.composeGroup)({ rawCommands: self.rawCommands });
          try {
            Object.entries(composed.command).some(([ name, command ]) => self.validateCommand({ name, command }));
            Object.entries(composed.group).some(([ name, group ]) => self.validateGroup({ name, group }));

            self.removes = composed.remove;
            self.commands = composed.command;
            self.groups = composed.group;
            self.modals = composed.modal;
          } catch (error) {
            self.apos.util.error('Command-Menu validation error');
            self.apos.util.error(error);
          }
        }
      }
    };
  },
  methods(self) {
    return {
      validateCommand({ name, command }) {
        assert.equal(command.type, 'item', `Invalid command type, must be "item", for ${name}`);
        assert.equal(typeof command.label, 'string', `Invalid command label, must be a string, for ${name} "${typeof command.label}" provided`);
        assert.equal(typeof command.action, 'object', `Invalid command action, must be an object for ${name}`) &&
          assert.equal(typeof command.action.type, 'string', `Invalid command action type for ${name}`) &&
          assert.equal(typeof command.action.payload, 'object', `Invalid command action payload for ${name}`);
        command.permission && (
          assert.equal(typeof command.permission, 'object', `Invalid command permission for ${name}`) &&
          assert.equal(typeof command.permission.action, 'string', `Invalid command permission action for ${name}`) &&
          assert.equal(typeof command.permission.type, 'string', `Invalid command permission type for ${name}`)
        );
        command.modal &&
          assert.equal(typeof command.modal, 'string', `Invalid command modal for ${name}`);
        assert.equal(typeof command.shortcut, 'string', `Invalid command shortcut, must be a string, for ${name}`);

        return true;
      },
      validateGroup({ name, group }) {
        assert.equal(typeof group.label, 'string', `Invalid group label, must be a string, for ${name}`);
        assert.equal(Array.isArray(group.fields), true, `Invalid command fields, must be an array for ${name}`);
        assert.ok(group.fields.every(field => typeof field === 'string'), `Invalid command fields, must contains strings, for ${name}`);

        return true;
      },
      composeRemove(initialState) {
        const concatenate = []
          .concat(...initialState.rawCommands.map(command => command.remove))
          .filter(isNotEmpty => isNotEmpty);

        return {
          ...initialState,
          remove: concatenate
        };
      },
      composeGroup(initialState) {
        const formatGroups = (state, { group }) => {
          return Object.entries(group)
            .reduce(
              (groups, [ name, attributes ]) => {
                return {
                  ...groups,
                  [name]: {
                    ...attributes,
                    fields: (groups[name]?.fields || []).concat(attributes.fields)
                  }
                };
              },
              state
            );
        };

        const concatenate = initialState.rawCommands.reduce(formatGroups, {});

        return {
          ...initialState,
          group: concatenate
        };
      },
      composeCommand(initialState) {
        const concatenate = []
          .concat(...initialState.rawCommands.map(command => command.add))
          .filter(isNotEmpty => isNotEmpty);

        return {
          ...initialState,
          command: concatenate
            .reduce(
              (acc, command) => ({
                ...acc,
                ...command
              }),
              {}
            )
        };
      },
      composeModal(initialState) { // TODO keep or remove
        const formatModals = (state, { group }) => {
          return state;
        };

        const concatenate = initialState.rawCommands.reduce(formatModals, {});

        return {
          ...initialState,
          modal: concatenate
        };
      },
      composeCommandsForModule(aposModule) {
        return aposModule.__meta.chain
          .map(entry => {
            const metadata = aposModule.__meta.commands[entry.name] || null;

            return typeof metadata === 'function'
              ? metadata(aposModule)
              : metadata;
          })
          .filter(entry => entry !== null);
      },
      isCommandVisible(req, command) {
        return command.permission
          ? self.apos.permissions.can(req, command.permission.action, command.permission.type, command.permission.mode || 'draft')
          : true;
      },
      getVisibleGroups(commands) {
        const keys = Object.keys(commands);

        return Object.fromEntries(
          Object.entries(self.groups)
            .map(([ key, group ]) => {
              const fields = group.fields
                .reduce(
                  (acc, field) => keys.includes(field)
                    ? { ...acc, [field]: commands[field] }
                    : acc,
                  {}
                );

              return Object.keys(fields).length
                ? [ key, { ...group, fields } ]
                : [];
            })
            .filter(groups => groups.length)
        );
      },
      getVisibleModals(commands) {
        const keys = Object.keys(commands);

        const groups = Object.fromEntries(
          Object.entries(self.groups)
            .map(([ key, group ]) => {
              const fields = group.fields
                .reduce(
                  (acc, field) => keys.includes(field)
                    ? { ...acc, [field]: commands[field] }
                    : acc,
                  {}
                );

              return Object.keys(fields).length
                ? [ key, { ...group, fields } ]
                : [];
            })
            .filter(groups => groups.length)
        );

        const modals = Object.entries(groups)
          .reduce(
            (acc, [ key, group ]) => {
              Object.entries(group.fields)
                .forEach(([ name, field ]) => {
                  const modal = field.modal || null;
                  acc[modal] = {
                    ...acc[modal],
                    [key]: {
                      ...(acc[modal]?.[key] || group),
                      fields: {
                        ...acc[modal]?.[key]?.fields,
                        [name]: field
                      }
                    }
                  };
                });

              return acc;
            },
            {}
          );

        return modals;
      },
      getVisible(req) {
        const commands = Object.fromEntries(
          Object.entries(self.commands)
            .map(([ key, command ]) => {
              return !self.removes.includes(key) && self.isCommandVisible(req, command)
                ? [ key, command ]
                : [];
            })
        );

        const groups = self.getVisibleGroups(commands);
        const modals = self.getVisibleModals(commands);

        return {
          groups,
          modals
        };
      },
      addShortcutModal() {
        self.apos.modal.add(
          `${self.__meta.name}:shortcut`,
          self.getComponentName('shortcutModal', 'AposCommandMenuShortcut'),
          { moduleName: self.__meta.name }
        );
      },
      getBrowserData(req) {
        if (!req.user) {
          return false;
        }

        const visible = self.getVisible(req);

        return {
          components: { the: self.options.components.the || 'TheAposCommandMenu' },
          groups: visible.groups,
          modals: visible.modals
        };
      }
    };
  }
};