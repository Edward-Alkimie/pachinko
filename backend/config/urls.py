from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.users.urls")),  # Kevin: accounts
    path("api/rounds/", include("apps.rounds.urls")),  # Kevin: rounds + seeds
    path("api/results/", include("apps.results.urls")),  # shared: outcomes + /verify check
    # Reserved for Kiana: path("api/verification/", include("apps.verification.urls")),
]
