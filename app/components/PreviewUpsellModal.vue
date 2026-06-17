<script setup lang="ts">
import { Eye, X, Cloud } from 'lucide-vue-next'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { message } = usePreviewReadOnly()

function closeModal() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50" @click="closeModal" />

      <div class="relative w-full max-w-md rounded-xl border border-surface-200 bg-white shadow-xl dark:border-surface-800 dark:bg-surface-900">
        <div class="flex items-center justify-between border-b border-surface-200 px-5 py-4 dark:border-surface-800">
          <div class="flex items-center gap-2">
            <Eye class="size-5 text-brand-600 dark:text-brand-400" />
            <h3 class="text-lg font-semibold text-surface-900 dark:text-surface-50">You're in the live demo</h3>
          </div>

          <button
            class="cursor-pointer text-surface-400 transition-colors hover:text-surface-600 dark:hover:text-surface-200"
            @click="closeModal"
          >
            <X class="size-5" />
          </button>
        </div>

        <div class="space-y-4 px-5 py-5">
          <p class="text-sm text-surface-600 dark:text-surface-300">
            {{ message }}
          </p>

          <p class="text-sm text-surface-500 dark:text-surface-400">
            Get full read &amp; write access:
          </p>

          <div class="space-y-2">
            <!-- Cloud hosted option -->
            <NuxtLink
              :to="$localePath('/auth/fresh-signup')"
              class="flex items-start gap-3 rounded-xl border border-brand-200 dark:border-brand-800 bg-gradient-to-r from-brand-50 to-violet-50 dark:from-brand-950/30 dark:to-violet-950/30 px-4 py-3 transition-all hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 no-underline group"
              @click="closeModal"
            >
              <div class="flex items-center justify-center size-9 rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white shrink-0 shadow-sm mt-0.5">
                <Cloud class="size-4" />
              </div>
              <div>
                <div class="text-sm font-semibold text-surface-900 dark:text-surface-100 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">Use Cloud Hosted</div>
                <div class="text-xs text-surface-500 dark:text-surface-400 mt-0.5">Start free in seconds — we handle hosting, updates &amp; backups</div>
              </div>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
