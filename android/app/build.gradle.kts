plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val configuredApiBaseUrl = providers.gradleProperty("DEBTAWARE_API_BASE_URL").orNull
val releaseRequested = gradle.startParameter.taskNames.any {
    it.contains("release", ignoreCase = true)
}
if (releaseRequested && configuredApiBaseUrl.isNullOrBlank()) {
    throw GradleException("Set -PDEBTAWARE_API_BASE_URL to the production HTTPS API URL for release builds.")
}
val apiBaseUrl = (configuredApiBaseUrl ?: "http://10.0.2.2:4000")
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")
if (releaseRequested && !apiBaseUrl.startsWith("https://")) {
    throw GradleException("Release builds require an HTTPS API URL.")
}

android {
    namespace = "za.co.debtaware"
    compileSdk = 36

    defaultConfig {
        applicationId = "za.co.debtaware"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "API_BASE_URL", "\"$apiBaseUrl\"")
    }

    buildTypes {
        debug {
            manifestPlaceholders["allowCleartext"] = "true"
        }
        release {
            manifestPlaceholders["allowCleartext"] = "false"
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }
}

dependencies {
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.0")
    implementation("androidx.work:work-runtime-ktx:2.10.2")
    implementation(platform("androidx.compose:compose-bom:2025.05.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
