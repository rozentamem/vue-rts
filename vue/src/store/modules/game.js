import { ISO_X_RATIO, ISO_Y_RATIO } from '../../utils/isometric';

// Размер всего ромбовидного поля на экране (в пикселях)
function getFieldSize(state) {
  const sum = state.gridWidth + state.gridHeight;
  return {
    width: sum * state.cellSize * ISO_X_RATIO,
    height: sum * state.cellSize * ISO_Y_RATIO,
  };
}

// Камера не должна уезжать за границы поля
function clampCamera(state) {
  const field = getFieldSize(state);
  const maxX = Math.max(0, field.width - state.viewport.width);
  const maxY = Math.max(0, field.height - state.viewport.height);
  state.camera.x = Math.min(Math.max(state.camera.x, 0), maxX);
  state.camera.y = Math.min(Math.max(state.camera.y, 0), maxY);
}

export default {
  namespaced: true,

  state: () => ({
    cellSize: 64,
    gridWidth: 30,
    gridHeight: 30,

    // Размер видимой области (обновляет компонент поля)
    viewport: { width: 0, height: 0 },

    // x, y - мировые координаты (плоские, в пикселях мира).
    // targetX/targetY - куда объект идёт сейчас (null = стоит).
    gameObjects: [
      { id: 1, type: 'character', x: 900, y: 880, targetX: null, targetY: null, speed: 120, color: '#4ade80' },
      { id: 2, type: 'character', x: 1010, y: 840, targetX: null, targetY: null, speed: 80, color: '#60a5fa' },
      { id: 3, type: 'character', x: 880, y: 1000, targetX: null, targetY: null, speed: 150, color: '#f87171' },
      // здание: speed 0 и targetX/targetY никогда не задаются
      { id: 4, type: 'building', x: 1060, y: 1060, targetX: null, targetY: null, speed: 0, color: '#a78bfa' },
    ],

    selectedObjectId: null,
    camera: { x: 0, y: 0 },
    cameraSpeed: 500,
  }),

  getters: {
    // Клетки поля: просто номера столбца и строки
    cells(state) {
      const cells = [];
      for (let y = 0; y < state.gridHeight; y++) {
        for (let x = 0; x < state.gridWidth; x++) {
          cells.push({ x, y });
        }
      }
      return cells;
    },

    // Сдвиг по X, чтобы левый угол ромба не уходил в отрицательные координаты
    fieldOffsetX(state) {
      return state.gridHeight * state.cellSize * ISO_X_RATIO;
    },
    fieldWidth(state) {
      return getFieldSize(state).width;
    },
    fieldHeight(state) {
      return getFieldSize(state).height;
    },
    // Размеры мира без проекции (нужны, чтобы ограничить цель движения)
    worldWidth(state) {
      return state.gridWidth * state.cellSize;
    },
    worldHeight(state) {
      return state.gridHeight * state.cellSize;
    },
  },

  mutations: {
    SELECT_OBJECT(state, id) {
      state.selectedObjectId = id;
    },
    DESELECT(state) {
      state.selectedObjectId = null;
    },
    SET_TARGET(state, { id, x, y }) {
      const obj = state.gameObjects.find((o) => o.id === id);
      if (obj) {
        obj.targetX = x;
        obj.targetY = y;
      }
    },
    SET_VIEWPORT(state, { width, height }) {
      state.viewport.width = width;
      state.viewport.height = height;
      clampCamera(state);
    },
    CENTER_CAMERA(state) {
      const field = getFieldSize(state);
      state.camera.x = (field.width - state.viewport.width) / 2;
      state.camera.y = (field.height - state.viewport.height) / 2;
      clampCamera(state);
    },
    MOVE_CAMERA(state, { dx, dy }) {
      state.camera.x += dx;
      state.camera.y += dy;
      clampCamera(state);
    },
    UPDATE_OBJECT_POSITION(state, { id, x, y, clearTarget }) {
      const obj = state.gameObjects.find((o) => o.id === id);
      if (!obj) return;
      obj.x = x;
      obj.y = y;
      if (clearTarget) {
        obj.targetX = null;
        obj.targetY = null;
      }
    },
  },

  actions: {
    setViewport({ commit }, size) {
      commit('SET_VIEWPORT', size);
    },
    centerCamera({ commit }) {
      commit('CENTER_CAMERA');
    },
    selectObject({ commit }, obj) {
      if (obj.type === 'building') return;
      commit('SELECT_OBJECT', obj.id);
    },
    deselectAll({ commit }) {
      commit('DESELECT');
    },
    orderMove({ commit, state, getters }, { x, y }) {
      if (state.selectedObjectId === null) return;
      const selected = state.gameObjects.find((o) => o.id === state.selectedObjectId);
      if (!selected || selected.type === 'building') return;

      // цель не может быть за пределами карты
      const targetX = Math.min(Math.max(x, 0), getters.worldWidth);
      const targetY = Math.min(Math.max(y, 0), getters.worldHeight);
      commit('SET_TARGET', { id: selected.id, x: targetX, y: targetY });
    },
    // Перетаскивание карты мышью (dx, dy уже в пикселях экрана)
    panCamera({ commit }, { dx, dy }) {
      commit('MOVE_CAMERA', { dx, dy });
    },
    // Камера: клавиши + подвод курсора к краю экрана (edge = -1 / 0 / 1 по осям)
    moveCamera({ commit, state }, { pressedKeys, edge, deltaTime }) {
      const distance = state.cameraSpeed * deltaTime;
      let dx = edge.x * distance;
      let dy = edge.y * distance;

      if (pressedKeys.has('arrowup') || pressedKeys.has('w')) dy -= distance;
      if (pressedKeys.has('arrowdown') || pressedKeys.has('s')) dy += distance;
      if (pressedKeys.has('arrowleft') || pressedKeys.has('a')) dx -= distance;
      if (pressedKeys.has('arrowright') || pressedKeys.has('d')) dx += distance;

      if (dx !== 0 || dy !== 0) {
        commit('MOVE_CAMERA', { dx, dy });
      }
    },
    // Движение к цели: те же dx / dy / distance, что мы разбирали в консоли.
    // Считается в плоских мировых координатах - проекция тут не нужна.
    moveObjects({ commit, state }, deltaTime) {
      for (const obj of state.gameObjects) {
        if (obj.targetX === null || obj.targetY === null) continue;

        const dx = obj.targetX - obj.x;
        const dy = obj.targetY - obj.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const step = obj.speed * deltaTime;

        if (step >= distance) {
          commit('UPDATE_OBJECT_POSITION', { id: obj.id, x: obj.targetX, y: obj.targetY, clearTarget: true });
        } else {
          commit('UPDATE_OBJECT_POSITION', {
            id: obj.id,
            x: obj.x + (dx / distance) * step,
            y: obj.y + (dy / distance) * step,
            clearTarget: false,
          });
        }
      }
    },
    tick({ dispatch }, { pressedKeys, edge, deltaTime }) {
      dispatch('moveCamera', { pressedKeys, edge, deltaTime });
      dispatch('moveObjects', deltaTime);
    },
  },
};
