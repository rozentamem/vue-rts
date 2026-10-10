<template>
  <div class="game-page">
    <div class="hint">
      Камера: зажать ЛКМ на пустом месте и тянуть, либо подвести курсор к краю экрана (стрелки / WASD тоже работают).
      ЛКМ по юниту — выбрать. ПКМ по полю — отправить выбранного юнита в точку.
    </div>

    <div
      class="viewport"
      ref="viewportRef"
      @mousedown.left="onPanStart"
      @mousemove="onViewportMove"
      @mouseleave="onViewportLeave"
    >
      <div
        class="field"
        ref="fieldRef"
        :style="fieldStyle"
        @click.left="onFieldClick"
        @contextmenu.prevent="onFieldRightClick"
      >
        <GameCell
          v-for="cell in cells"
          :key="'cell-' + cell.x + '-' + cell.y"
          :cell="cell"
          :cell-size="cellSize"
          :offset-x="offsetX"
        />

        <GameObject
          v-for="obj in gameObjects"
          :key="obj.id"
          :obj="obj"
          :cell-size="cellSize"
          :offset-x="offsetX"
          :is-selected="obj.id === selectedObjectId"
          @select="onObjectSelect"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import GameCell from './GameCell.vue';
import GameObject from './GameObject.vue';
import { screenToWorld } from '../../utils/isometric';

const store = useStore();

// Все данные лежат в сторе, компонент только показывает их и отправляет действия
const cellSize = computed(() => store.state.game.cellSize);
const cells = computed(() => store.getters['game/cells']);
const gameObjects = computed(() => store.state.game.gameObjects);
const selectedObjectId = computed(() => store.state.game.selectedObjectId);
const camera = computed(() => store.state.game.camera);
const offsetX = computed(() => store.getters['game/fieldOffsetX']);

const fieldRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);

const fieldStyle = computed(() => ({
  width: store.getters['game/fieldWidth'] + 'px',
  height: store.getters['game/fieldHeight'] + 'px',
  transform: `translate(${-camera.value.x}px, ${-camera.value.y}px)`,
}));

// ---------- выбор и приказ ----------
function onObjectSelect(obj: any) {
  store.dispatch('game/selectObject', obj);
}

function onFieldClick() {
  // после перетаскивания карты клик не должен снимать выделение
  if (panMoved) return;
  store.dispatch('game/deselectAll');
}

function onFieldRightClick(event: MouseEvent) {
  if (selectedObjectId.value === null) return;

  // getBoundingClientRect уже учитывает сдвиг камеры (transform)
  const rect = fieldRef.value!.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;

  // переводим точку экрана обратно в плоские мировые координаты
  const world = screenToWorld(screenX, screenY, offsetX.value);
  store.dispatch('game/orderMove', { x: world.x, y: world.y });
}

// ---------- камера мышью ----------
let panning = false;
let panMoved = false;
let panDistance = 0;
let lastX = 0;
let lastY = 0;

function onPanStart(e: MouseEvent) {
  panning = true;
  panMoved = false;
  panDistance = 0;
  lastX = e.clientX;
  lastY = e.clientY;
}

function onWindowMouseMove(e: MouseEvent) {
  if (!panning) return;

  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;

  panDistance += Math.abs(dx) + Math.abs(dy);
  // маленькое дрожание руки при обычном клике не считаем перетаскиванием
  if (panDistance > 5) panMoved = true;

  if (panMoved) {
    // карта "едет" за курсором, поэтому камера двигается в обратную сторону
    store.dispatch('game/panCamera', { dx: -dx, dy: -dy });
  }
}

function onWindowMouseUp() {
  panning = false;
}

// подвод курсора к краю области - камера плавно едет в эту сторону
const EDGE_SIZE = 20;
const edge = { x: 0, y: 0 };

function onViewportMove(e: MouseEvent) {
  const rect = viewportRef.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  edge.x = x < EDGE_SIZE ? -1 : x > rect.width - EDGE_SIZE ? 1 : 0;
  edge.y = y < EDGE_SIZE ? -1 : y > rect.height - EDGE_SIZE ? 1 : 0;
}

function onViewportLeave() {
  edge.x = 0;
  edge.y = 0;
}

// ---------- клавиатура (дополнительно) ----------
const pressedKeys = new Set<string>();

function onKeyDown(e: KeyboardEvent) {
  pressedKeys.add(e.key.toLowerCase());
}
function onKeyUp(e: KeyboardEvent) {
  pressedKeys.delete(e.key.toLowerCase());
}

// ---------- игровой цикл ----------
let lastTime = 0;
let animationFrameId = 0;

function gameLoop(time: number) {
  const deltaTime = lastTime === 0 ? 0 : (time - lastTime) / 1000;
  lastTime = time;

  // во время перетаскивания край экрана камеру не двигает
  const activeEdge = panning ? { x: 0, y: 0 } : edge;
  store.dispatch('game/tick', { pressedKeys, edge: activeEdge, deltaTime });

  animationFrameId = requestAnimationFrame(gameLoop);
}

// ---------- размер видимой области ----------
let resizeObserver: ResizeObserver | null = null;
let firstResize = true;

function updateViewport() {
  const el = viewportRef.value;
  if (!el) return;
  store.dispatch('game/setViewport', { width: el.clientWidth, height: el.clientHeight });
  if (firstResize) {
    firstResize = false;
    store.dispatch('game/centerCamera');
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);

  resizeObserver = new ResizeObserver(updateViewport);
  resizeObserver.observe(viewportRef.value!);
  updateViewport();

  animationFrameId = requestAnimationFrame(gameLoop);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('mousemove', onWindowMouseMove);
  window.removeEventListener('mouseup', onWindowMouseUp);
  resizeObserver?.disconnect();
  cancelAnimationFrame(animationFrameId);
});
</script>

<style scoped>
.game-page {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0b1220;
  user-select: none;
}

.hint {
  flex: none;
  color: #e5e7eb;
  font-family: sans-serif;
  font-size: 13px;
  padding: 8px 16px;
  background: #111827;
}

.viewport {
  position: relative;
  flex: 1;
  overflow: hidden;
  cursor: grab;
}

.field {
  position: absolute;
  left: 0;
  top: 0;
}
</style>
