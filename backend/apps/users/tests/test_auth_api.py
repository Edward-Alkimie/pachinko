from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient, APITestCase

PASSWORD = "correct-horse-battery-9"


class AuthApiTests(APITestCase):
    def setUp(self):
        cache.clear()  # throttle counters live in the cache

    def register(self, username="kevin", password=PASSWORD):
        return self.client.post("/api/auth/register", {"username": username, "password": password}, format="json")

    def test_register_creates_user_with_hashed_password_and_logs_in(self):
        response = self.register()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data, {"id": response.data["id"], "username": "kevin"})
        user = get_user_model().objects.get(username="kevin")
        self.assertNotEqual(user.password, PASSWORD)
        self.assertTrue(user.check_password(PASSWORD))
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)

    def test_register_rejects_duplicate_username(self):
        self.register()
        self.client.post("/api/auth/logout")
        response = self.register()
        self.assertEqual(response.status_code, 400)
        self.assertIn("username", response.data)

    def test_register_rejects_weak_password(self):
        response = self.register(password="123")
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data)

    def test_register_requires_fields(self):
        response = self.client.post("/api/auth/register", {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_login_and_logout(self):
        get_user_model().objects.create_user("kevin", password=PASSWORD)

        response = self.client.post("/api/auth/login", {"username": "kevin", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["username"], "kevin")
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)

        self.assertEqual(self.client.post("/api/auth/logout").status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 403)

    def test_login_with_wrong_password_gives_generic_error(self):
        get_user_model().objects.create_user("kevin", password=PASSWORD)
        wrong_pw = self.client.post("/api/auth/login", {"username": "kevin", "password": "nope"}, format="json")
        no_user = self.client.post("/api/auth/login", {"username": "ghost", "password": "nope"}, format="json")

        self.assertEqual(wrong_pw.status_code, 400)
        self.assertEqual(wrong_pw.data, no_user.data)  # don't reveal which usernames exist

    def test_login_rejects_inactive_user(self):
        user = get_user_model().objects.create_user("kevin", password=PASSWORD)
        user.is_active = False
        user.save()
        response = self.client.post("/api/auth/login", {"username": "kevin", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_me_requires_login(self):
        self.assertEqual(self.client.get("/api/auth/me").status_code, 403)

    def test_login_is_rate_limited(self):
        statuses = [
            self.client.post("/api/auth/login", {"username": "x", "password": "y"}, format="json").status_code
            for _ in range(12)
        ]
        self.assertIn(429, statuses)

    def test_spoofed_forwarded_for_does_not_bypass_rate_limit(self):
        statuses = [
            self.client.post(
                "/api/auth/login",
                {"username": "x", "password": "y"},
                format="json",
                HTTP_X_FORWARDED_FOR=f"10.0.0.{i}",
            ).status_code
            for i in range(12)
        ]
        self.assertIn(429, statuses)

    def test_register_rejects_unicode_lookalike_of_existing_username(self):
        self.register("kevin")
        self.client.post("/api/auth/logout")
        response = self.register("ｋevin")  # fullwidth k, NFKC-normalizes to "kevin"
        self.assertEqual(response.status_code, 400)
        self.assertIn("username", response.data)

    def test_login_normalizes_username(self):
        get_user_model().objects.create_user("kevin", password=PASSWORD)
        response = self.client.post("/api/auth/login", {"username": "ｋevin", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_register_race_on_same_username_is_400_not_500(self):
        from django.db import IntegrityError

        with mock.patch.object(get_user_model().objects, "create_user", side_effect=IntegrityError("dup")):
            response = self.register("racer")
        self.assertEqual(response.status_code, 400)
        self.assertIn("username", response.data)

    def test_csrf_endpoint_sets_cookie_and_post_needs_token(self):
        csrf_client = APIClient(enforce_csrf_checks=True)
        blocked = csrf_client.post("/api/auth/register", {"username": "a", "password": PASSWORD}, format="json")
        self.assertEqual(blocked.status_code, 403)

        response = csrf_client.get("/api/auth/csrf")
        self.assertEqual(response.status_code, 200)
        token = response.cookies["csrftoken"].value
        allowed = csrf_client.post(
            "/api/auth/register", {"username": "a", "password": PASSWORD}, format="json", HTTP_X_CSRFTOKEN=token
        )
        self.assertEqual(allowed.status_code, 201)
