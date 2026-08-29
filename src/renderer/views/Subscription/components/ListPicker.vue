<template>
  <material-modal :show="modelValue" teleport="#view" width="72%" @close="emit('update:model-value', false)">
    <main :class="$style.main">
      <div :class="$style.header">
        <base-selection v-model="source" :list="sourceList" item-key="id" item-name="name" />
        <base-tab v-model="tab" :class="$style.tabs" :list="tabs" />
      </div>

      <div v-if="tab == 'board'" :class="$style.content">
        <div v-if="boardList.length" :class="$style.boardList">
          <button
            v-for="item in boardList"
            :key="item.id"
            :class="$style.boardItem"
            @click="selectBoard(item)"
          >{{ item.name }}</button>
        </div>
        <p v-else :class="$style.empty">{{ boardLoading ? $t('subscription__picker_board_loading') : (boardError || $t('subscription__picker_board_empty')) }}</p>
      </div>

      <div v-else :class="$style.content">
        <div v-if="playlistInfo.list.length" :class="$style.playlistList">
          <button
            v-for="item in playlistInfo.list"
            :key="item.id"
            type="button"
            :class="$style.playlistItem"
            @click="selectPlaylist(item)"
          >
            <img :src="item.img" alt="" :class="$style.img" />
            <div :class="$style.desc">
              <b>{{ item.name }}</b>
              <small>{{ item.author }}</small>
            </div>
          </button>
        </div>
        <p v-else :class="$style.empty">{{ playlistLoading ? $t('subscription__picker_playlist_loading') : (playlistError || $t('subscription__picker_playlist_empty')) }}</p>
        <div v-if="playlistInfo.total > playlistInfo.limit" :class="$style.pagination">
          <material-pagination
            :count="playlistInfo.total"
            :limit="playlistInfo.limit"
            :page="playlistInfo.page"
            @btn-click="togglePage"
          />
        </div>
      </div>
    </main>
  </material-modal>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from '@common/utils/vueTools'
import musicSdk from '@renderer/utils/musicSdk'
import { getBoardsList } from '@renderer/store/leaderboard/action'
import { useI18n } from '@root/lang'
import type { BoardItem } from '@renderer/store/leaderboard/state'
import type { ListInfoItem } from '@renderer/store/songList/state'

interface ListPickerSelection {
  source: LX.OnlineSource
  listType: LX.Subscription.ListType
  listId: string
  name: string
}

const props = defineProps<{
  modelValue: boolean
  sourceList: Array<{ id: LX.OnlineSource, name: string }>
}>()

const emit = defineEmits<{
  'update:model-value': [value: boolean]
  select: [selection: ListPickerSelection]
}>()

const t = useI18n()

const tabs = computed(() => [
  { id: 'board', label: t('subscription__picker_tab_board') },
  { id: 'playlist', label: t('subscription__picker_tab_playlist') },
])

const tab = ref<'board' | 'playlist'>('board')
const source = ref<LX.OnlineSource>('wy')

const boardList = ref<BoardItem[]>([])
const boardLoading = ref(false)
const boardError = ref('')

const playlistInfo = ref<{
  list: ListInfoItem[]
  total: number
  page: number
  limit: number
}>({ list: [], total: 0, page: 1, limit: 30 })
const playlistLoading = ref(false)
const playlistError = ref('')

const loadBoards = async() => {
  boardLoading.value = true
  boardError.value = ''
  try {
    const board = await getBoardsList(source.value)
    boardList.value = board?.list ?? []
  } catch (err) {
    boardList.value = []
    boardError.value = err instanceof Error ? err.message : String(err)
  } finally {
    boardLoading.value = false
  }
}

const loadPlaylists = async(page: number) => {
  playlistLoading.value = true
  playlistError.value = ''
  try {
    const result = await musicSdk[source.value]?.songList.getList('', '', page)
    if (result == null) throw new Error(t('subscription__picker_playlist_unsupported'))
    playlistInfo.value = {
      list: result.list ?? [],
      total: result.total ?? 0,
      page: result.page ?? page,
      limit: result.limit ?? 30,
    }
  } catch (err) {
    playlistInfo.value = { list: [], total: 0, page, limit: 30 }
    playlistError.value = err instanceof Error ? err.message : String(err)
  } finally {
    playlistLoading.value = false
  }
}

const togglePage = (page: number) => {
  void loadPlaylists(page)
}

const selectBoard = (item: BoardItem) => {
  emit('select', { source: source.value, listType: 'board', listId: item.id, name: item.name })
  emit('update:model-value', false)
}

const selectPlaylist = (item: ListInfoItem) => {
  emit('select', { source: source.value, listType: 'playlist', listId: item.id, name: item.name })
  emit('update:model-value', false)
}

watch([() => props.modelValue, tab, source], () => {
  if (!props.modelValue) return
  if (tab.value == 'board') {
    void loadBoards()
  } else {
    void loadPlaylists(1)
  }
})
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  height: 72vh;
  min-height: 320px;
  display: flex;
  flex-flow: column nowrap;
  overflow: hidden;
}
.header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 15px;
  border-bottom: var(--color-list-header-border-bottom);
}
.tabs {
  border-bottom: 0;
}
.content {
  flex: auto;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 15px;
}
.boardList {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}
.boardItem {
  appearance: none;
  border: 1px solid var(--color-primary-alpha-100);
  background: var(--color-primary-background);
  color: var(--color-font);
  border-radius: 6px;
  padding: 14px 10px;
  font-size: 13px;
  cursor: pointer;
  text-align: center;
  .mixin-ellipsis-1();
  &:hover {
    color: var(--color-primary);
    border-color: var(--color-primary-alpha-500);
  }
  &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
}
.playlistList {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.playlistItem {
  appearance: none;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  &:hover {
    background-color: var(--color-primary-background-hover);
  }
  &:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
}
.img {
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 4px;
  object-fit: cover;
}
.desc {
  flex: auto;
  min-width: 0;
  b {
    display: block;
    font-size: 13px;
    color: var(--color-font);
    .mixin-ellipsis-1();
  }
  small {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: var(--color-font-label);
    .mixin-ellipsis-1();
  }
}
.empty {
  padding: 60px 0;
  text-align: center;
  color: var(--color-font-label);
  font-size: 14px;
}
.pagination {
  display: flex;
  justify-content: center;
  padding: 14px 0 4px;
}
@media (max-width: 900px) {
  .boardList { grid-template-columns: repeat(3, 1fr); }
  .playlistList { grid-template-columns: repeat(2, 1fr); }
}
</style>
