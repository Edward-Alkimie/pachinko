from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/rounds/", include("apps.rounds.urls")),
    path("api/results/", include("apps.results.urls")),
]
