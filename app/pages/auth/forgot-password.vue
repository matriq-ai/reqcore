<script setup lang="ts">
const { t } = useI18n();

definePageMeta({
    layout: "auth",
    middleware: ["guest"],
});

useSeoMeta({
    title: t("auth.forgotPassword.pageTitle"),
    description: t("auth.forgotPassword.pageDescription"),
    robots: "noindex, nofollow",
});

const email = ref("");
const error = ref("");
const success = ref(false);
const isLoading = ref(false);
const localePath = useLocalePath();
const { track } = useTrack();

onMounted(() => track("forgot_password_page_viewed"));

async function handleRequestReset() {
    error.value = "";

    if (!email.value) {
        error.value = t("auth.forgotPassword.emailRequired");
        return;
    }

    isLoading.value = true;

    try {
        const result = await authClient.requestPasswordReset({
            email: email.value,
            redirectTo: `${window.location.origin}${localePath("/auth/reset-password")}`,
        });

        if (result.error) {
            error.value =
                result.error.message ?? t("auth.forgotPassword.sendFailedDefault");
            isLoading.value = false;
            return;
        }
    } catch (e: unknown) {
        error.value =
            e instanceof Error ? e.message : t("auth.forgotPassword.sendFailedDefault");
        isLoading.value = false;
        return;
    }

    track("forgot_password_submitted");

    // Always show success to prevent email enumeration
    success.value = true;
    isLoading.value = false;
}
</script>

<template>
    <div class="flex flex-col gap-4">
        <h2
            class="text-xl font-semibold text-center text-surface-900 dark:text-surface-100 mb-2"
        >
            {{ $t('auth.forgotPassword.heading') }}
        </h2>

        <template v-if="success">
            <div
                class="rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 p-3 text-sm text-green-700 dark:text-green-400"
            >
                {{ $t('auth.forgotPassword.successMessage') }}
            </div>

            <p class="text-center text-sm text-surface-500 dark:text-surface-400 mt-2">
                <NuxtLink
                    :to="$localePath('/auth/sign-in')"
                    class="text-brand-600 dark:text-brand-400 hover:underline"
                >
                    {{ $t('auth.forgotPassword.backToSignIn') }}
                </NuxtLink>
            </p>
        </template>

        <template v-else>
            <p class="text-sm text-surface-500 dark:text-surface-400 text-center">
                {{ $t('auth.forgotPassword.instructions') }}
            </p>

            <div
                v-if="error"
                class="rounded-md border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-950 p-3 text-sm text-danger-700 dark:text-danger-400"
            >
                {{ error }}
            </div>

            <form class="flex flex-col gap-4" @submit.prevent="handleRequestReset">
                <label
                    class="flex flex-col gap-1 text-sm font-medium text-surface-700 dark:text-surface-300"
                >
                    <span>{{ $t('auth.forgotPassword.emailLabel') }}</span>
                    <input
                        v-model="email"
                        type="email"
                        autocomplete="email"
                        required
                        class="px-3 py-2 border border-surface-300 dark:border-surface-700 rounded-md text-sm text-surface-900 dark:text-surface-100 bg-white dark:bg-surface-800 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
                    />
                </label>

                <button
                    type="submit"
                    :disabled="isLoading"
                    class="mt-2 px-4 py-2.5 bg-brand-600 text-white rounded-md text-sm font-medium cursor-pointer hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                    {{ isLoading ? $t('auth.forgotPassword.sending') : $t('auth.forgotPassword.submitButton') }}
                </button>
            </form>

            <p class="text-center text-sm text-surface-500 dark:text-surface-400">
                {{ $t('auth.forgotPassword.rememberPassword') }}
                <NuxtLink
                    :to="$localePath('/auth/sign-in')"
                    class="text-brand-600 dark:text-brand-400 hover:underline"
                >
                    {{ $t('auth.forgotPassword.signInLink') }}
                </NuxtLink>
            </p>
        </template>
    </div>
</template>
